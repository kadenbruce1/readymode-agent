const { getStagehand } = require('../stagehand');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

async function uploadAndConfigure({ campaign_name, file_url, create_new_campaign = false }) {
  if (!campaign_name) throw new Error('campaign_name is required.');
  if (!file_url) throw new Error('file_url is required.');

  const tempPath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
  await downloadFile(file_url, tempPath);

  const { stagehand, page } = await getStagehand();

  try {

    // ── GET SESSION COOKIES ───────────────────────────────────────────────

    console.log('[uploadAndConfigure] Getting session cookies...');
    await page.goto(process.env.READYMODE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const cookies = await page.context().cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log(`[uploadAndConfigure] Got ${cookies.length} cookies`);

    const baseUrl = process.env.READYMODE_URL;

    // ── POST CSV DIRECTLY TO UPLOAD API ──────────────────────────────────

    console.log('[uploadAndConfigure] Uploading CSV via API...');
    const form = new FormData();
    form.append('fromContainerId', 'xcont-5');
    form.append('leadfile', fs.createReadStream(tempPath), {
      filename: path.basename(tempPath),
      contentType: 'text/csv',
    });

    const uploadResponse = await axios.post(
      `${baseUrl}/AI%20Leads/upload/index.php`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Cookie': cookieString,
          'Referer': baseUrl,
          'Origin': baseUrl,
        },
        maxRedirects: 5,
      }
    );

    // Log first 500 chars of response to see what we get
    const responseText = String(uploadResponse.data);
    console.log('[uploadAndConfigure] Upload response preview:', responseText.substring(0, 500));

    // Try multiple patterns to find the process ID
    const processMatch =
      responseText.match(/AI Leads\/process\/(\d+)/) ||
      responseText.match(/Leads\/process\/(\d+)/) ||
      responseText.match(/process\/(\d+)/) ||
      responseText.match(/spawn\([^,]+,\s*['"](?:AI Leads\/)?process\/(\d+)['"]/);

    if (!processMatch) {
      throw new Error(`Could not find process ID in response: ${responseText.substring(0, 300)}`);
    }

    const processId = processMatch[1];
    console.log(`[uploadAndConfigure] Process ID: ${processId}`);

    // ── NAVIGATE TO FIELD MAPPING PAGE ───────────────────────────────────

    console.log('[uploadAndConfigure] Clicking Leads...');
    await page.evaluate(() => {
      const links = document.querySelectorAll('a.dash_link');
      for (const link of links) {
        if (link.getAttribute('href') === '-AI Leads/pools') {
          link.click();
          break;
        }
      }
    });
    await page.waitForTimeout(3000);

    // Navigate the iframe directly to the process page
    console.log(`[uploadAndConfigure] Navigating iframe to process ${processId}...`);
    await page.evaluate((pid) => {
      const iframe = document.querySelector('iframe[name="lead_csv_postwindow"]');
      if (iframe) {
        iframe.src = `/AI%20Leads/process/${pid}`;
      }
    }, processId);
    await page.waitForTimeout(3000);

    // ── POLL ALL FRAMES FOR FIELD MAPPING SCREEN ─────────────────────────

    console.log('[uploadAndConfigure] Polling for field mapping screen...');
    let fieldFrame = null;
    for (let i = 0; i < 20; i++) {
      for (const frame of page.frames()) {
        try {
          const btn = await frame.$('input[value="Done - Import leads"]');
          if (btn) {
            fieldFrame = frame;
            console.log(`[uploadAndConfigure] Found in frame: ${frame.name()}`);
            break;
          }
        } catch {}
      }
      if (fieldFrame) break;
      await page.waitForTimeout(1000);
      console.log(`[uploadAndConfigure] Polling... ${i + 1}`);
    }

    if (!fieldFrame) throw new Error('Field mapping screen never appeared');
    console.log('[uploadAndConfigure] Field mapping loaded!');

    // ── SELECT CAMPAIGN ──────────────────────────────────────────────────

    console.log(`[uploadAndConfigure] Selecting campaign: ${campaign_name}`);

    if (create_new_campaign) {
      await fieldFrame.click('text=Add a New Campaign');
      await page.waitForTimeout(1000);
      await fieldFrame.fill('input[type="text"]:visible', campaign_name);
      await page.waitForTimeout(500);
      await fieldFrame.click('button:has-text("OK"), input[value="OK"]');
      await page.waitForTimeout(1500);
    } else {
      const matched = await fieldFrame.evaluate((name) => {
        const selects = document.querySelectorAll('select');
        for (const select of selects) {
          const options = Array.from(select.options);
          const match = options.find(o =>
            o.text.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(o.text.toLowerCase())
          );
          if (match) {
            select.value = match.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof tmp !== 'undefined' && tmp.CCS_Leads_CheckCampaign) {
              tmp.CCS_Leads_CheckCampaign(select);
            }
            return match.text;
          }
        }
        return null;
      }, campaign_name);
      console.log(`[uploadAndConfigure] Campaign matched: ${matched || 'not found'}`);
      await page.waitForTimeout(1000);
    }

    // ── IMPORT ───────────────────────────────────────────────────────────

    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await fieldFrame.click('input[value="Done - Import leads"]');
    await page.waitForTimeout(5000);

    // ── PART 2: CONFIGURE CAMPAIGN ───────────────────────────────────────

    console.log('[uploadAndConfigure] Going to Campaigns tab...');
    await page.click('#ui-id-18');
    await page.waitForTimeout(2000);

    console.log(`[uploadAndConfigure] Opening campaign: ${campaign_name}`);
    const campItem = page.locator(`#campaign_list li:has-text("${campaign_name}")`).first();
    await campItem.waitFor({ timeout: 10000 });
    await campItem.click();
    await page.waitForTimeout(2000);

    // Phone Groups → Check All
    console.log('[uploadAndConfigure] Assigning phone groups...');
    await page.locator('button.ui-multiselect').nth(0).click();
    await page.waitForTimeout(1000);
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Call Results → Check All → Uncheck 4
    console.log('[uploadAndConfigure] Configuring call results...');
    await page.locator('button.ui-multiselect').nth(1).click();
    await page.waitForTimeout(1000);
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);

    const excluded = ['CS Log', 'Transfer', 'Not Available', 'Not in Service'];
    for (const item of excluded) {
      try {
        const label = page.locator(`label:has-text("${item}")`).first();
        const isChecked = await label.locator('input[type="checkbox"]').isChecked().catch(() => false);
        if (isChecked) {
          await label.click();
          await page.waitForTimeout(300);
          console.log(`[uploadAndConfigure] Unchecked: ${item}`);
        }
      } catch (e) {
        console.log(`[uploadAndConfigure] Could not uncheck "${item}": ${e.message}`);
      }
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    try {
      await page.click('img.closer.accordion-container-closer');
      await page.waitForTimeout(1000);
    } catch {}

    return {
      message: `Leads uploaded to *${campaign_name}*${create_new_campaign ? ' (new campaign created)' : ''}. Phone groups assigned and call results configured.`,
    };

  } finally {
    await stagehand.close();
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    };
    const file = fs.createWriteStream(destPath);
    protocol.get(url, options, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

module.exports = { uploadAndConfigure };
