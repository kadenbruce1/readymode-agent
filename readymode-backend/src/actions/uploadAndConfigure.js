const { getStagehand } = require('../stagehand');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function uploadAndConfigure({ campaign_name, file_url, create_new_campaign = false }) {
  if (!campaign_name) throw new Error('campaign_name is required.');
  if (!file_url) throw new Error('file_url is required.');

  const tempPath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
  await downloadFile(file_url, tempPath);

  const { stagehand, page } = await getStagehand();
  try {

    // ── PART 1: UPLOAD LEADS ─────────────────────────────────────────────

    // Start from dashboard
    console.log('[uploadAndConfigure] Going to dashboard...');
    await page.goto(process.env.READYMODE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Click Leads via JavaScript to bypass visibility issues
    console.log('[uploadAndConfigure] Clicking Leads via JS...');
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

    // Click Upload Leads
    console.log('[uploadAndConfigure] Clicking Upload Leads...');
    await page.evaluate(() => {
      const upload = document.querySelector('a.uploadlink');
      if (upload) upload.click();
    });
    await page.waitForTimeout(2000);

    // Click OK on popup if it appears
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
      await page.waitForTimeout(3000);
    }

    // Select or create campaign
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
      await page.waitForTimeout(2000);

      const campaignItem = page.locator(`#campaign_list li:has-text("${campaign_name}")`).first();
      const listVisible = await campaignItem.isVisible().catch(() => false);

      if (listVisible) {
        await campaignItem.click();
        await page.waitForTimeout(500);
        await campaignItem.click();
        await page.waitForTimeout(500);
      } else {
        const selectEl = await page.$('select[name="set[campaignId]"]');
        if (selectEl) {
          await page.selectOption('select[name="set[campaignId]"]', { label: campaign_name });
        } else {
          await page.click(`text="${campaign_name}"`);
          await page.waitForTimeout(500);
          await page.click(`text="${campaign_name}"`);
        }
        await page.waitForTimeout(500);
      }
    }

    // Click Done - Import leads
    console.log('[uploadAndConfigure] Importing leads...');
    await page.click('input[value="Done - Import leads"]');
    await page.waitForTimeout(5000);

    // ── PART 2: CONFIGURE CAMPAIGN ───────────────────────────────────────

    // Go to Campaigns tab
    console.log('[uploadAndConfigure] Going to Campaigns tab...');
    await page.click('#ui-id-18');
    await page.waitForTimeout(2000);

    // Click the campaign
    console.log(`[uploadAndConfigure] Opening campaign: ${campaign_name}`);
    const campItem = page.locator(`#campaign_list li:has-text("${campaign_name}")`).first();
    await campItem.waitFor({ timeout: 10000 });
    await campItem.click();
    await page.waitForTimeout(2000);

    // Open Phone Groups → Check All
    console.log('[uploadAndConfigure] Assigning phone groups...');
    const phoneGroupBtn = page.locator('button.ui-multiselect').nth(0);
    await phoneGroupBtn.click();
    await page.waitForTimeout(1000);
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Open Call Results → Check All → Uncheck 4
    console.log('[uploadAndConfigure] Configuring call results...');
    const callResultBtn = page.locator('button.ui-multiselect').nth(1);
    await callResultBtn.click();
    await page.waitForTimeout(1000);
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);

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

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Close campaign
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
