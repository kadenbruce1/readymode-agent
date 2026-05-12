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

    console.log('[uploadAndConfigure] Going to dashboard...');
    await page.goto(process.env.READYMODE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Click Leads via JS
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

    // Click Upload Leads via JS
    console.log('[uploadAndConfigure] Clicking Upload Leads...');
    await page.evaluate(() => {
      const upload = document.querySelector('a.uploadlink');
      if (upload) upload.click();
    });
    await page.waitForTimeout(2000);

    // The file picker opens — use setInputFiles on the hidden file input
    // We need to intercept the file chooser
    console.log('[uploadAndConfigure] Handling file upload...');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      // The file chooser should already be open from clicking Upload Leads
      // If not, try clicking any file input
      page.$('input[type="file"]').then(el => el && el.click()).catch(() => {}),
    ]);

    if (fileChooser) {
      await fileChooser.setFiles(tempPath);
      console.log('[uploadAndConfigure] File set via file chooser');
    } else {
      // Fallback: directly set the file input
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) await fileInput.setInputFiles(tempPath);
    }
    await page.waitForTimeout(2000);

    // Handle confirmation popup — "Confirm: uploading lead file" → click OK
    console.log('[uploadAndConfigure] Confirming file upload...');
    try {
      page.on('dialog', dialog => dialog.accept());
      await page.waitForTimeout(1000);
    } catch {}

    // Also try clicking OK button if it's a custom dialog
    try {
      await page.waitForSelector('button:has-text("OK")', { timeout: 5000 });
      await page.click('button:has-text("OK")');
      await page.waitForTimeout(2000);
    } catch {}

    // ── Field mapping screen is now showing ──────────────────────────────

    // Select campaign from the Campaign Name dropdown on the RIGHT side
    console.log(`[uploadAndConfigure] Setting campaign: ${campaign_name}`);

    if (create_new_campaign) {
      // Type new campaign name directly
      await page.waitForSelector('input[name*="campaign"], #campaign_name', { timeout: 5000 });
      await page.fill('input[name*="campaign"], #campaign_name', campaign_name);
    } else {
      // Find the Campaign Name select on the right side of the screen
      await page.waitForTimeout(2000);

      // Use evaluate to find and set the campaign dropdown by partial name match
      const matched = await page.evaluate((name) => {
        // Look for select elements that contain campaign options
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
            return match.text;
          }
        }
        return null;
      }, campaign_name);

      if (matched) {
        console.log(`[uploadAndConfigure] Selected campaign: ${matched}`);
      } else {
        console.log(`[uploadAndConfigure] Could not find campaign "${campaign_name}" in any dropdown — proceeding anyway`);
      }
      await page.waitForTimeout(1000);
    }

    // Click Done - Import leads
    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await page.click('button:has-text("Done - Import leads"), input[value="Done - Import leads"]');
    await page.waitForTimeout(5000);

    // ── PART 2: CONFIGURE CAMPAIGN ───────────────────────────────────────

    // Go to Campaigns tab
    console.log('[uploadAndConfigure] Going to Campaigns tab...');
    await page.click('#ui-id-18');
    await page.waitForTimeout(2000);

    // Click the campaign in the list
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
