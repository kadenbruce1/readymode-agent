const { getStagehand } = require('../stagehand');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');

async function uploadAndConfigure({ campaign_name, channel_name, file_url }) {
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

    // ── OPEN LEAD MANAGEMENT PANEL ────────────────────────────────────────

    console.log('[uploadAndConfigure] Opening Lead Management panel...');
    const leadsPanelOpened = await page.evaluate(() => {
      const els = document.querySelectorAll('a, div, span, img');
      for (const el of els) {
        const title = (el.getAttribute('title') || '').toLowerCase();
        const alt   = (el.getAttribute('alt')   || '').toLowerCase();
        const text  = (el.textContent            || '').trim().toLowerCase();
        if (title.includes('lead') || alt.includes('lead') || text === 'leads') {
          el.click();
          return true;
        }
      }
      return false;
    });

    if (!leadsPanelOpened) {
      await page.locator('[title*="Lead"], [alt*="Lead"]').first().click({ timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(2000);

    // ── CLICK UPLOAD LEADS (intercept file chooser) ───────────────────────

    console.log('[uploadAndConfigure] Clicking Upload Leads...');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.locator('text=Upload Leads').first().click(),
    ]);

    console.log(`[uploadAndConfigure] File chooser opened, attaching file...`);
    await fileChooser.setFiles(tempPath);
    console.log('[uploadAndConfigure] File attached');

    // ── WAIT FOR UPLOAD CONFIRMATION SCREEN ──────────────────────────────

    console.log('[uploadAndConfigure] Waiting for upload confirmation screen...');
    // The h1 "Lead upload confirmation" is display:none — wait for the form instead
    await page.waitForSelector('#leadsendform', { state: 'attached', timeout: 90000 });
    console.log('[uploadAndConfigure] Confirmation screen loaded');
    await page.waitForTimeout(1500);

    // ── SELECT CAMPAIGN ───────────────────────────────────────────────────

    console.log(`[uploadAndConfigure] Selecting campaign: ${campaign_name}`);

    // The confirmation screen loads inside the lead_csv_postwindow iframe
    console.log('[uploadAndConfigure] Looking for confirmation iframe...');
    let confirmFrame = null;
    for (let i = 0; i < 15; i++) {
      for (const frame of page.frames()) {
        try {
          const sel = await frame.$('select[listof="campaigns"]');
          if (sel) { confirmFrame = frame; break; }
        } catch {}
      }
      if (confirmFrame) break;
      await page.waitForTimeout(1000);
      console.log(`[uploadAndConfigure] Polling for iframe... attempt ${i + 1}`);
    }

    if (!confirmFrame) throw new Error('Campaign dropdown not found in any frame');
    console.log(`[uploadAndConfigure] Found campaign dropdown in frame: ${confirmFrame.name()}`);

    // Wait for options to populate
    await confirmFrame.waitForFunction(() => {
      const s = document.querySelector('select[listof="campaigns"]');
      return s && s.options.length > 1;
    }, { timeout: 10000 });
    console.log('[uploadAndConfigure] Campaign dropdown populated');

    const campaignSelected = await confirmFrame.evaluate((name) => {
      const container = document.querySelector('#xcont-6') ||
                        document.querySelector('#leadsendform') ||
                        document.querySelector('form[tagged="1"]') ||
                        document;
      const select = container.querySelector('select[listof="campaigns"]');
      if (!select) return 'ERROR: select[listof="campaigns"] not found in form container';
      const options = Array.from(select.options);
      console.log('Available campaigns:', options.map(o => `${o.value}:${o.text}`).join(', '));
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

    // ── SELECT CHANNEL (optional) ─────────────────────────────────────────

    if (channel_name) {
      console.log(`[uploadAndConfigure] Selecting channel: ${channel_name}`);
      const channelSelected = await confirmFrame.evaluate((name) => {
        const selects = document.querySelectorAll('select');
        for (const select of selects) {
          const options = Array.from(select.options);
          const match = options.find(o =>
            o.text.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(o.text.toLowerCase())
          );
          if (match && select.options[select.selectedIndex]?.text !== match.text) {
            select.value = match.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return match.text;
          }
        }
        return null;
      }, channel_name);

      console.log(`[uploadAndConfigure] Channel: ${channelSelected || 'not found, using default'}`);
      await page.waitForTimeout(500);
    }

    // ── CLICK DONE - IMPORT LEADS ─────────────────────────────────────────

    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await confirmFrame.locator('button:has-text("Done - Import leads"), input[value="Done - Import leads"]')
      .first()
      .click({ timeout: 10000 });

    console.log('[uploadAndConfigure] Waiting 5s for import to process...');
    await page.waitForTimeout(5000);

    const stillOnConfirmation = await page.$('text=Lead upload confirmation').catch(() => null);
    if (!stillOnConfirmation) {
      console.log('[uploadAndConfigure] ✅ Import complete — confirmation screen closed');
    } else {
      console.log('[uploadAndConfigure] Import submitted');
    }

    return {
      message: `✅ Leads uploaded to campaign *${campaignSelected}*${channel_name ? ` via channel *${channel_name}*` : ''}.`,
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
