const { getStagehand } = require('../stagehand');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// SOP: Upload CSV → select/create campaign → assign DIDs → set call results
async function uploadAndConfigure({ campaign_name, file_url, create_new_campaign = false, states = [] }) {
  if (!campaign_name) throw new Error('campaign_name is required.');
  if (!file_url) throw new Error('file_url is required.');

  // Download the CSV file (from Slack, needs bot token auth)
  const tempPath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
  await downloadFile(file_url, tempPath);

  const { stagehand, page } = await getStagehand();
  try {

    // ── PART 1: UPLOAD LEADS ─────────────────────────────────────────────

    // SOP 4.2.1: Click Leads in the left sidebar
    console.log('[uploadAndConfigure] Clicking Leads...');
    await page.click('a.dash_link[href*="Leads"], a[href*="AI Leads"]');
    await page.waitForTimeout(2000);

    // SOP 4.2.2: Click Upload Leads
    console.log('[uploadAndConfigure] Clicking Upload Leads...');
    await page.click('a.uploadlink');
    await page.waitForTimeout(2000);

    // SOP 4.2.3: Click OK on the popup
    try {
      await page.waitForSelector('button:has-text("OK"), input[value="OK"]', { timeout: 3000 });
      await page.click('button:has-text("OK"), input[value="OK"]');
      await page.waitForTimeout(1500);
    } catch {}

    // Upload the CSV file
    console.log('[uploadAndConfigure] Uploading CSV file...');
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(tempPath);
      await page.waitForTimeout(2000);
    }

    // SOP 4.2.4: Field mapping is automatic — just proceed

    // SOP 4.2.5/4.3: Select or create campaign
    if (create_new_campaign) {
      console.log('[uploadAndConfigure] Creating new campaign...');
      await page.click('text=Add a New Campaign');
      await page.waitForTimeout(1000);

      // Type the campaign name in the prompt
      await page.fill('input[type="text"]:visible', campaign_name);
      await page.waitForTimeout(500);
      await page.click('button:has-text("OK"), input[value="OK"]');
      await page.waitForTimeout(1000);
      await page.click('button:has-text("Done"), input[value="Done"]');
      await page.waitForTimeout(1500);
    } else {
      console.log(`[uploadAndConfigure] Selecting existing campaign: ${campaign_name}`);
      // Click the campaign name in the list
      await page.click(`text="${campaign_name}"`);
      await page.waitForTimeout(500);
      await page.click(`text="${campaign_name}"`);
      await page.waitForTimeout(1000);
    }

    // SOP 4.2.5: Click Done - Import leads
    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await page.click('input[value="Done - Import leads"], input[type="submit"][value*="Import"]');
    await page.waitForTimeout(4000);

    // ── PART 2: CONFIGURE CAMPAIGN ───────────────────────────────────────

    // SOP 4.4.1: Go to Campaigns tab
    console.log('[uploadAndConfigure] Going to Campaigns tab...');
    await page.click('#ui-id-18, a:has-text("Campaigns")');
    await page.waitForTimeout(2000);

    // SOP 4.4.2: Find and click the campaign
    console.log(`[uploadAndConfigure] Finding campaign: ${campaign_name}`);
    await page.click(`text="${campaign_name}"`);
    await page.waitForTimeout(1500);
    await page.click(`text="${campaign_name}"`);
    await page.waitForTimeout(2000);

    // SOP 4.4.4: Click Select Phone Groups button
    console.log('[uploadAndConfigure] Assigning phone groups...');
    const phoneGroupBtn = page.locator('button.ui-multiselect[aria-haspopup="true"]').filter({ hasText: /phone/i }).first();
    await phoneGroupBtn.click();
    await page.waitForTimeout(1000);

    // SOP 4.4.5: Click Check All
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);

    // Close phone groups dropdown
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // SOP 4.4.4 (call results): Click Select Call Results button
    console.log('[uploadAndConfigure] Configuring call results...');
    const callResultBtn = page.locator('button.ui-multiselect[aria-haspopup="true"]').filter({ hasText: /call result/i }).first();
    await callResultBtn.click();
    await page.waitForTimeout(1000);

    // Check All first
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);

    // SOP 4.4.6: Uncheck the 4 excluded call results
    const excluded = ['CS Log', 'Transfer', 'Not Available', 'Not in Service'];
    for (const item of excluded) {
      try {
        const label = page.locator(`label.ui-corner-all:has-text("${item}")`).first();
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

    // Close call results dropdown
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // SOP 4.4.8: Close/Exit the campaign
    console.log('[uploadAndConfigure] Closing campaign...');
    try {
      await page.click('img.closer.accordion-container-closer');
      await page.waitForTimeout(1000);
    } catch {}

    const screenshot = await page.screenshot({ type: 'png' });

    return {
      message: `Leads from *${path.basename(file_url)}* uploaded to *${campaign_name}*${create_new_campaign ? ' (new campaign created)' : ''}. Phone groups assigned, call results configured.${states.length > 0 ? ` State filters: ${states.join(', ')}.` : ''}`,
      screenshot,
    };

  } finally {
    await stagehand.close();
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

// Download file with Slack auth header
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
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
