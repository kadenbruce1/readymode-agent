const { getStagehand } = require('../stagehand');
const { getSession } = require('../browserbase');
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

  // Read the CSV as base64 so we can inject it via CDP
  const fileBuffer = fs.readFileSync(tempPath);
  const fileBase64 = fileBuffer.toString('base64');
  const fileName = path.basename(tempPath);

  const { stagehand, page } = await getStagehand();

  // Get CDP session for direct browser control
  const cdpSession = await page.context().newCDPSession(page);

  try {

    // Register dialog handler FIRST
    page.on('dialog', async dialog => {
      console.log(`[uploadAndConfigure] Dialog accepted: ${dialog.message()}`);
      await dialog.accept();
    });

    // ── NAVIGATE TO LEADS ────────────────────────────────────────────────

    console.log('[uploadAndConfigure] Going to dashboard...');
    await page.goto(process.env.READYMODE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Load Leads tab via Readymode's own JS function
    console.log('[uploadAndConfigure] Loading Leads tab via JS...');
    await page.evaluate(() => {
      tmp.UITab_LoadDynTab('AI Leads/pools', 'xcont-14');
    });
    await page.waitForTimeout(3000);

    // ── INJECT FILE VIA CDP ──────────────────────────────────────────────

    console.log('[uploadAndConfigure] Finding file input via CDP...');

    // Get the file input node using CDP DOM
    const { root } = await cdpSession.send('DOM.getDocument');
    const { nodeId: fileInputNodeId } = await cdpSession.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]',
    });

    if (fileInputNodeId) {
      // Use CDP to set the file directly on the input
      await cdpSession.send('DOM.setFileInputFiles', {
        files: [tempPath],
        nodeId: fileInputNodeId,
      });
      console.log('[uploadAndConfigure] File injected via CDP');
    } else {
      // Fallback — make input visible and set via Playwright
      await page.evaluate(() => {
        document.querySelectorAll('input[type="file"]').forEach(i => {
          i.style.cssText = 'display:block!important;visibility:visible!important;opacity:1!important;position:fixed!important;top:0!important;left:0!important;';
        });
      });
      await page.waitForTimeout(500);
      await page.locator('input[type="file"]').first().setInputFiles(tempPath);
      console.log('[uploadAndConfigure] File set via fallback');
    }

    await page.waitForTimeout(2000);

    // ── WAIT FOR FIELD MAPPING SCREEN ────────────────────────────────────

    console.log('[uploadAndConfigure] Waiting for field mapping screen...');
    await page.waitForSelector('input[value="Done - Import leads"]', { timeout: 20000 });
    console.log('[uploadAndConfigure] Field mapping screen loaded!');

    // ── SELECT CAMPAIGN ──────────────────────────────────────────────────

    console.log(`[uploadAndConfigure] Selecting campaign: ${campaign_name}`);

    if (create_new_campaign) {
      // Click Add a New Campaign link
      const addLink = await page.$('text=Add a New Campaign');
      if (addLink) {
        await addLink.click();
        await page.waitForTimeout(1000);
        await page.fill('input[type="text"]:visible', campaign_name);
        await page.waitForTimeout(500);
        await page.click('button:has-text("OK"), input[value="OK"]');
        await page.waitForTimeout(1500);
      }
    } else {
      // Use CDP to find and set the campaign select
      const matched = await page.evaluate((name) => {
        // Try the named campaign select first
        const campaignSelect = document.querySelector('select[name="set[campaignId]"], select[listof="campaigns"]');
        if (campaignSelect) {
          const options = Array.from(campaignSelect.options);
          const match = options.find(o =>
            o.text.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(o.text.toLowerCase())
          );
          if (match) {
            campaignSelect.value = match.value;
            campaignSelect.dispatchEvent(new Event('change', { bubbles: true }));
            // Also call Readymode's check function if available
            if (typeof tmp !== 'undefined' && tmp.CCS_Leads_CheckCampaign) {
              tmp.CCS_Leads_CheckCampaign(campaignSelect);
            }
            return match.text;
          }
        }

        // Fallback — search all selects
        const allSelects = document.querySelectorAll('select');
        for (const select of allSelects) {
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

      console.log(`[uploadAndConfigure] Campaign selected: ${matched || 'not found'}`);
      await page.waitForTimeout(1000);
    }

    // ── IMPORT LEADS ─────────────────────────────────────────────────────

    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await page.click('input[value="Done - Import leads"]');
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
    await cdpSession.detach().catch(() => {});
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
