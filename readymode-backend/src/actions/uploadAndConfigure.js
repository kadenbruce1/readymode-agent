const { getStagehand } = require('../stagehand');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

async function uploadAndConfigure({ campaign_name, file_url, create_new_campaign = false }) {
  if (!campaign_name) throw new Error('campaign_name is required.');
  if (!file_url) throw new Error('file_url is required.');

  // ── DOWNLOAD FILE FROM SLACK ──────────────────────────────────────────

  const tempPath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
  await downloadFile(file_url, tempPath);

  const fileSize = fs.statSync(tempPath).size;
  console.log(`[uploadAndConfigure] Downloaded file size: ${fileSize} bytes`);
  if (fileSize < 100) throw new Error(`Downloaded file too small (${fileSize} bytes)`);

  const { stagehand, page } = await getStagehand();

  try {

    // ── NAVIGATE TO READYMODE ─────────────────────────────────────────────

    console.log('[uploadAndConfigure] Navigating to Readymode...');
    await page.goto(process.env.READYMODE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // ── GET SESSION COOKIES ───────────────────────────────────────────────

    const cookies = await page.context().cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log(`[uploadAndConfigure] Got ${cookies.length} cookies`);

    // ── OPEN LEAD MANAGEMENT PANEL ────────────────────────────────────────

    console.log('[uploadAndConfigure] Opening Lead Management panel...');
    await page.evaluate(() => {
      const links = document.querySelectorAll('a, div, span');
      for (const el of links) {
        const title = (el.getAttribute('title') || '').toLowerCase();
        const text = (el.textContent || '').trim().toLowerCase();
        if (title === 'leads' || text === 'leads') {
          el.click();
          return;
        }
      }
    });
    await page.waitForTimeout(2000);

    // ── INTERCEPT THE UPLOAD REQUEST ─────────────────────────────────────
    // Let a real fileChooser trigger happen to capture the real upload URL
    // and form fields, then fulfill it normally but also replay with our file.

    let capturedUploadUrl = null;
    let capturedPostData = null;
    let capturedHeaders = null;

    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        const url = request.url();
        console.log(`[uploadAndConfigure] POST intercepted: ${url}`);
        capturedUploadUrl = url;
        capturedHeaders = request.headers();
        capturedPostData = request.postDataBuffer();
        await route.continue();
      } else {
        await route.continue();
      }
    });

    // Trigger file chooser with our actual file
    console.log('[uploadAndConfigure] Triggering file upload...');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      page.locator('text=Upload Leads').first().click(),
    ]);

    await fileChooser.setFiles(tempPath);
    console.log('[uploadAndConfigure] File set via fileChooser');

    // Wait to see if any POST fires automatically after file selection
    await page.waitForTimeout(3000);
    console.log(`[uploadAndConfigure] Auto-POST captured: ${capturedUploadUrl || 'none'}`);

    // If no auto-POST, submit the form manually
    if (!capturedUploadUrl) {
      console.log('[uploadAndConfigure] No auto-POST — submitting form manually...');
      await page.evaluate(() => {
        const form = document.querySelector('#leadsendform');
        if (form) {
          if (form.requestSubmit) form.requestSubmit();
          else form.submit();
        }
      });
      await page.waitForTimeout(3000);
      console.log(`[uploadAndConfigure] POST after manual submit: ${capturedUploadUrl || 'still none'}`);
    }

    // Remove route interceptor
    await page.unroute('**/*');

    // ── IF WE CAPTURED THE URL, REPLAY WITH AXIOS ────────────────────────

    if (capturedUploadUrl) {
      console.log(`[uploadAndConfigure] Replaying upload to: ${capturedUploadUrl}`);
      const form = new FormData();
      form.append('leadfile', fs.createReadStream(tempPath), {
        filename: path.basename(tempPath),
        contentType: 'text/csv',
      });

      // Add any non-file form fields from the captured post data if possible
      try {
        const replayResponse = await axios.post(capturedUploadUrl, form, {
          headers: {
            ...form.getHeaders(),
            'Cookie': cookieString,
            'Referer': process.env.READYMODE_URL,
            'Origin': process.env.READYMODE_URL,
          },
          maxRedirects: 5,
        });
        console.log(`[uploadAndConfigure] Replay response (${replayResponse.status}): ${String(replayResponse.data).substring(0, 300)}`);
      } catch (e) {
        console.log(`[uploadAndConfigure] Replay failed: ${e.message}`);
      }
    }

    // ── WAIT FOR CAMPAIGN DROPDOWN TO POPULATE ────────────────────────────

    console.log('[uploadAndConfigure] Waiting for confirmation screen...');
    try {
      await page.waitForFunction(() => {
        const s = document.querySelector('select[listof="campaigns"]');
        return s && s.options.length > 1;
      }, { timeout: 30000 });
      console.log('[uploadAndConfigure] Confirmation screen loaded');
    } catch (e) {
      // Log iframe state for debugging
      const iframeContent = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[name="lead_csv_postwindow"]');
        if (!iframe) return 'no iframe';
        try {
          return iframe.contentDocument?.body?.innerHTML?.substring(0, 300) || 'empty';
        } catch { return 'cross-origin blocked'; }
      });
      console.log(`[uploadAndConfigure] Iframe content: ${iframeContent}`);
      throw new Error(`Confirmation screen never loaded: ${e.message}`);
    }
    await page.waitForTimeout(500);

    // ── SELECT CAMPAIGN ───────────────────────────────────────────────────

    console.log(`[uploadAndConfigure] Selecting campaign: ${campaign_name}`);
    const campaignSelected = await page.evaluate((name) => {
      const select = document.querySelector('select[listof="campaigns"]');
      if (!select) return 'ERROR: select not found';
      const options = Array.from(select.options);
      const match = options.find(o =>
        o.text.trim().toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(o.text.trim().toLowerCase())
      );
      if (match) {
        select.value = match.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof tmp !== 'undefined' && tmp.CCS_Leads_CheckCampaign) {
          tmp.CCS_Leads_CheckCampaign(select);
        }
        return match.text.trim();
      }
      return 'NO_MATCH:' + options.map(o => o.text.trim()).filter(Boolean).join(' | ');
    }, campaign_name);

    if (!campaignSelected || campaignSelected.startsWith('NO_MATCH:') || campaignSelected.startsWith('ERROR:')) {
      throw new Error(`Campaign "${campaign_name}" not found. Result: ${campaignSelected}`);
    }
    console.log(`[uploadAndConfigure] Campaign selected: ${campaignSelected}`);
    await page.waitForTimeout(500);

    // ── CLICK DONE - IMPORT LEADS ─────────────────────────────────────────

    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await page.locator('button:has-text("Done - Import leads"), input[value="Done - Import leads"]')
      .first()
      .click({ timeout: 10000 });

    console.log('[uploadAndConfigure] Waiting 8s for import to process...');
    await page.waitForTimeout(8000);
    console.log('[uploadAndConfigure] Import complete');

    return {
      message: `✅ Leads uploaded to campaign *${campaignSelected}*.`,
    };

  } finally {
    await stagehand.close();
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

async function downloadFile(url, destPath) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    headers: {
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    maxRedirects: 5,
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

module.exports = { uploadAndConfigure };
