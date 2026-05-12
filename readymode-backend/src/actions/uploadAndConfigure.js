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

    // Set file directly on any hidden file input without triggering file chooser
    console.log('[uploadAndConfigure] Setting file on input...');
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length > 0) {
      for (const input of fileInputs) {
        try {
          await input.setInputFiles(tempPath);
          console.log('[uploadAndConfigure] File set on input');
          break;
        } catch (e) {
          console.log('[uploadAndConfigure] Could not set file on input:', e.message);
        }
      }
    }
    await page.waitForTimeout(2000);

    // Handle native browser dialog (confirm upload)
    page.on('dialog', async dialog => {
      console.log('[uploadAndConfigure] Dialog:', dialog.message());
      await dialog.accept();
    });
    await page.waitForTimeout(1000);

    // Also try clicking OK if custom dialog
    try {
      const okBtn = await page.$('button:has-text("OK")');
      if (okBtn) {
        await okBtn.click();
        console.log('[uploadAndConfigure] Clicked OK button');
      }
      await page.waitForTimeout(2000);
    } catch {}

    // Wait for field mapping screen
    console.log('[uploadAndConfigure] Waiting for field mapping screen...');
    await page.waitForTimeout(3000);

    // Set campaign from the dropdown on the right side
    console.log(`[uploadAndConfigure] Setting campaign: ${campaign_name}`);

    if (create_new_campaign) {
      // Click Add a New Campaign
      await page.click('text=Add a New Campaign');
      await page.waitForTimeout(1000);
      await page.fill('input[type="text"]:visible', campaign_name);
      await page.waitForTimeout(500);
      await page.click('button:has-text("OK"), input[value="OK"]');
      await page.waitForTimeout(1000);
    } else {
      // Scan all select elements for matching campaign
      const matched = await page.evaluate((name) => {
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
        console.log(`[uploadAndConfigure] Campaign not found in dropdowns — proceeding`);
      }
      await page.waitForTimeout(1000);
    }

    // Click Done - Import leads
    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await page.click('input[value="Done - Import leads"], button:has-text("Done - Import leads")');
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
    const phoneGroupBtn = page.locator('button.ui-multiselect').nth(0);
    await phoneGroupBtn.click();
    await page.waitForTimeout(1000);
    await page.click('a.ui-multiselect-all');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Call Results → Check All → Uncheck 4
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
