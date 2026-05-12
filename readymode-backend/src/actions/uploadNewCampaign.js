const { getStagehand } = require('../stagehand');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

async function uploadNewCampaign({ campaign_name, file_url }) {
  if (!campaign_name) throw new Error('campaign_name is required.');
  if (!file_url) throw new Error('file_url is required.');

  // ── DOWNLOAD FILE FROM SLACK ──────────────────────────────────────────

  const tempPath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
  await downloadFile(file_url, tempPath);

  const fileSize = fs.statSync(tempPath).size;
  console.log(`[uploadNewCampaign] Downloaded file size: ${fileSize} bytes`);
  if (fileSize < 100) throw new Error(`Downloaded file too small (${fileSize} bytes)`);

  const { stagehand, page } = await getStagehand();

  try {

    // ── NAVIGATE TO READYMODE ─────────────────────────────────────────────

    console.log('[uploadNewCampaign] Navigating to Readymode...');
    await page.goto(process.env.READYMODE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // ── GET SESSION COOKIES ───────────────────────────────────────────────

    const cookies = await page.context().cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log(`[uploadNewCampaign] Got ${cookies.length} cookies`);

    const baseUrl = process.env.READYMODE_URL;

    // ── OPEN LEAD MANAGEMENT PANEL ────────────────────────────────────────

    console.log('[uploadNewCampaign] Opening Lead Management panel...');
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

    // ── UPLOAD CSV VIA AXIOS ──────────────────────────────────────────────

    console.log('[uploadNewCampaign] Uploading CSV via API...');
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

    const responseText = String(uploadResponse.data);
    console.log('[uploadNewCampaign] Upload response preview:', responseText.substring(0, 300));

    // Extract process ID from spawn call in response
    // Response contains: spawn('page_work', 'AI Leads/process/233')
    const processMatch =
      responseText.match(/spawn\s*\([^,]+,\s*['"]AI Leads\/process\/(\d+)['"]/i) ||
      responseText.match(/spawn\s*\([^,]+,\s*['"](?:AI%20Leads|AI Leads)\/process\/(\d+)['"]/i) ||
      responseText.match(/AI[% ](?:20)?Leads\/process\/(\d+)/) ||
      responseText.match(/process\/(\d+)/);

    if (!processMatch) {
      throw new Error(`Could not find process ID in response: ${responseText.substring(0, 300)}`);
    }

    const processId = processMatch[1];
    console.log(`[uploadNewCampaign] Process ID: ${processId}`);

    // ── EXECUTE SPAWN IN BROWSER TO LOAD CONFIRMATION SCREEN ─────────────

    // First make sure the Leads panel is open and xcont-5 is active
    console.log('[uploadNewCampaign] Activating Leads panel...');
    await page.evaluate(() => {
      const links = document.querySelectorAll('a.dash_link');
      for (const link of links) {
        if ((link.getAttribute('href') || '').includes('AI Leads')) {
          link.click();
          return;
        }
      }
    });
    await page.waitForTimeout(3000);

    // Wait for xcont-5 XCContainerObject to be initialized
    console.log('[uploadNewCampaign] Waiting for xcont-5 to initialize...');
    await page.waitForFunction(() => {
      try {
        const el = document.querySelector('#xcont-5');
        if (!el) return false;
        const container = el.XCContainerObject;
        return container && container.content && container.content.executionContext;
      } catch { return false; }
    }, { timeout: 15000 });
    console.log('[uploadNewCampaign] xcont-5 initialized');

    console.log(`[uploadNewCampaign] Spawning confirmation screen for process ${processId}...`);
    const spawned = await page.evaluate((pid) => {
      try {
        const el = document.querySelector('#xcont-5');
        if (!el) return 'ERROR: #xcont-5 not found';
        const container = el.XCContainerObject;
        if (!container) return 'ERROR: XCContainerObject not found';
        if (!container.content) return 'ERROR: container.content not found';
        if (!container.content.executionContext) return 'ERROR: executionContext not found';
        container.content.executionContext.spawn('page_work', `AI Leads/process/${pid}`);
        return `OK: spawned AI Leads/process/${pid}`;
      } catch (e) {
        return `ERROR: ${e.message}`;
      }
    }, processId);

    console.log(`[uploadNewCampaign] Spawn result: ${spawned}`);

    if (spawned.startsWith('ERROR')) {
      throw new Error(`Spawn failed: ${spawned}`);
    }

    // ── WAIT FOR CAMPAIGN DROPDOWN TO POPULATE ────────────────────────────

    console.log('[uploadNewCampaign] Waiting for confirmation screen to load...');
    await page.waitForFunction(() => {
      const s = document.querySelector('select[listof="campaigns"]');
      return s && s.options.length > 1;
    }, { timeout: 30000 });
    console.log('[uploadNewCampaign] Confirmation screen loaded');
    await page.waitForTimeout(500);

    // ── SELECT CAMPAIGN ───────────────────────────────────────────────────

    console.log(`[uploadNewCampaign] Creating new campaign: ${campaign_name}`);

    // Register dialog handler BEFORE triggering the select change
    page.once('dialog', async (dialog) => {
      console.log(`[uploadNewCampaign] Dialog: ${dialog.message()}`);
      await dialog.accept(campaign_name);
      console.log(`[uploadNewCampaign] Dialog accepted with: ${campaign_name}`);
    });

    const addSelected = await page.evaluate(() => {
      const select = document.querySelector('select[listof="campaigns"]');
      if (!select) return 'ERROR: select not found';
      const addOption = Array.from(select.options).find(o =>
        o.value === '-1' || o.text.toLowerCase().includes('add a new campaign')
      );
      if (!addOption) return 'ERROR: Add a new campaign option not found';
      select.value = addOption.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof tmp !== 'undefined' && tmp.CCS_Leads_CheckCampaign) {
        tmp.CCS_Leads_CheckCampaign(select);
      }
      return 'OK';
    });

    if (addSelected !== 'OK') throw new Error(`Could not select Add new campaign: ${addSelected}`);

    // Wait for dialog to be handled
    await page.waitForTimeout(3000);
    console.log(`[uploadNewCampaign] New campaign created: ${campaign_name}`);

    // ── CLICK DONE - IMPORT LEADS ─────────────────────────────────────────

    console.log('[uploadNewCampaign] Clicking Done - Import leads...');
    await page.locator('button:has-text("Done - Import leads"), input[value="Done - Import leads"]')
      .first()
      .click({ timeout: 10000 });

    console.log('[uploadNewCampaign] Waiting 8s for import to process...');
    await page.waitForTimeout(8000);
    console.log('[uploadNewCampaign] Import complete');

    return {
      message: `✅ New campaign *${campaign_name}* created and leads uploaded.`,
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

module.exports = { uploadNewCampaign };
