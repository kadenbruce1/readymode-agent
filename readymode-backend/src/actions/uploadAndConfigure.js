const { getStagehand } = require('../stagehand');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// SOP: Upload CSV → select/create campaign → assign phone groups → set call results
async function uploadAndConfigure({ campaign_name, file_url, create_new_campaign = false }) {
  if (!campaign_name) throw new Error('campaign_name is required.');
  if (!file_url) throw new Error('file_url is required.');

  // Download the CSV file (Slack requires bot token auth)
  const tempPath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
  await downloadFile(file_url, tempPath);

  const { stagehand, page } = await getStagehand();
  try {

    // ── PART 1: UPLOAD LEADS ─────────────────────────────────────────────

    // SOP 4.2.1: Navigate to Leads section via JS tab loader
    console.log('[uploadAndConfigure] Navigating to Leads...');
    await page.evaluate(() => {
      tmp.UITab_LoadDynTab('AI Leads/pools', 'xcont-14');
    });
    await page.waitForTimeout(3000);

    // SOP 4.2.2: Click Upload Leads
    console.log('[uploadAndConfigure] Clicking Upload Leads...');
    await page.click('a.uploadlink');
    await page.waitForTimeout(2000);

    // SOP 4.2.3: Click OK on the popup if it appears
    try {
      await page.waitForSelector('button:has-text("OK"), input[value="OK"]', { timeout: 3000 });
      await page.click('button:has-text("OK"), input[value="OK"]');
      await page.waitForTimeout(1500);
    } catch {}

    // Upload the CSV file
    console.log('[uploadAndConfigure] Uploading CSV...');
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(tempPath);
      await page.waitForTimeout(2000);
    }

    // SOP 4.2.5/4.3: Select or create campaign
    if (create_new_campaign) {
      console.log('[uploadAndConfigure] Creating new campaign...');
      await page.click('text=Add a New Campaign');
      await page.waitForTimeout(1000);
      await page.fill('input[type="text"]:visible', campaign_name);
      await page.waitForTimeout(500);
      await page.click('button:has-text("OK"), input[value="OK"]');
      await page.waitForTimeout(1000);
      await page.click('button:has-text("Done"), input[value="Done"]');
      await page.waitForTimeout(1500);
    } else {
      console.log(`[uploadAndConfigure] Selecting campaign: ${campaign_name}`);
      await page.click(`select[name="set[campaignId]"]`);
      await page.selectOption(`select[name="set[campaignId]"]`, { label: campaign_name });
      await page.waitForTimeout(1000);
    }

    // SOP 4.2.5: Click Done - Import leads
    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await page.click('input[value="Done - Import leads"]');
    await page.waitForTimeout(5000);

    // ── PART 2: CONFIGURE CAMPAIGN ───────────────────────────────────────

    // SOP 4.4.1: Go to Campaigns tab
    console.log('[uploadAndConfigure] Going to Campaigns tab...');
    await page.click('#ui-id-18');
    await page.waitForTimeout(2000);

    // SOP 4.4.2: Find and click the campaign in the list
    console.log(`[uploadAndConfigure] Finding campaign: ${campaign_name}`);
    await page.click(`li:has-text("${campaign_name}")`);
    await page.waitForTimeout(2000);

    // SOP 4.4.4: Click Select Phone Groups button
    console.log('[uploadAndConfigure] Opening phone groups...');
    const phoneGroupBtn = page.locator('button.ui-multiselect').filter({ hasText: /None selected/i }).first();
    await phoneGroupBtn.click();
    await page.waitForTimeout(1000);

    // SOP 4.4.5: Click Check All
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);

    // Close phone groups dropdown by clicking elsewhere
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // SOP: Now open Call Results
    console.log('[uploadAndConfigure] Opening call results...');
    const callResultBtn = page.locator('button.ui-multiselect').filter({ hasText: /None selected/i }).first();
    await callResultBtn.click();
    await page.waitForTimeout(1000);

    // Check All
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);

    // SOP 4.4.6: Uncheck the 4 excluded call results
    const excluded = ['CS Log', 'Transfer', 'Not Available', 'Not in Service'];
    for (const item of excluded) {
      try {
        const label = page.locator(`label:has-text("${item}")`).first();
        const checkbox = label.locator('input[type="checkbox"]');
        const isChecked = await checkbox.isChecked().catch(() => false);
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

    // SOP 4.4.8: Close the campaign view
    console.log('[uploadAndConfigure] Closing campaign...');
    try {
      await page.click('img.closer.accordion-container-closer');
      await page.waitForTimeout(1000);
    } catch {}

    return {
      message: `Leads uploaded to *${campaign_name}*${create_new_campaign ? ' (new campaign created)' : ''}. Phone groups assigned and call results configured (CS Log, Transfer, Not Available, Not in Service excluded).`,
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
