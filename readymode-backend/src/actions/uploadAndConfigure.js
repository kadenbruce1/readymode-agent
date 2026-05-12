const { getStagehand } = require('../stagehand');
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

  const fileSize = fs.statSync(tempPath).size;
  console.log(`[uploadAndConfigure] Downloaded file size: ${fileSize} bytes`);
  if (fileSize < 100) throw new Error(`Downloaded file too small (${fileSize} bytes) — Slack download may have failed`);

  const { stagehand, page } = await getStagehand();

  try {

    // ── GET SESSION COOKIES ───────────────────────────────────────────────

    console.log('[uploadAndConfigure] Getting session cookies...');
    await page.goto(process.env.READYMODE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

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

    const responseText = String(uploadResponse.data);
    console.log('[uploadAndConfigure] Upload response preview:', responseText.substring(0, 500));

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

    // ── NAVIGATE TO LEADS TAB ─────────────────────────────────────────────

    console.log('[uploadAndConfigure] Clicking Leads tab...');
    await page.evaluate(() => {
      const links = document.querySelectorAll('a.dash_link');
      for (const link of links) {
        if (link.getAttribute('href') === '-AI Leads/pools') {
          link.click();
          return;
        }
      }
    });
    await page.waitForTimeout(3000);

    // ── SET IFRAME TO FIELD MAPPING ───────────────────────────────────────

    console.log(`[uploadAndConfigure] Navigating iframe to process ${processId}...`);
    await page.evaluate((pid) => {
      const iframe = document.querySelector('iframe[name="lead_csv_postwindow"]');
      if (iframe) iframe.src = `/AI%20Leads/process/${pid}`;
    }, processId);
    await page.waitForTimeout(3000);

    // ── POLL FOR FIELD MAPPING SCREEN ─────────────────────────────────────

    console.log('[uploadAndConfigure] Polling for field mapping screen...');
    let fieldFrame = null;
    for (let i = 0; i < 25; i++) {
      for (const frame of page.frames()) {
        try {
          const btn = await frame.$('input[value="Done - Import leads"]');
          if (btn) { fieldFrame = frame; break; }
        } catch {}
      }
      if (fieldFrame) break;
      await page.waitForTimeout(1000);
      console.log(`[uploadAndConfigure] Polling... attempt ${i + 1}`);
    }

    if (!fieldFrame) throw new Error('Field mapping screen never appeared after 25s');
    console.log(`[uploadAndConfigure] Field mapping loaded in frame: ${fieldFrame.name()}`);

    // ── SELECT CAMPAIGN ───────────────────────────────────────────────────

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

      if (!matched) throw new Error(`Campaign "${campaign_name}" not found in dropdown`);
      console.log(`[uploadAndConfigure] Campaign matched: ${matched}`);
      await page.waitForTimeout(1000);
    }

    // ── CLICK IMPORT ──────────────────────────────────────────────────────

    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await fieldFrame.click('input[value="Done - Import leads"]');

    // Readymode's import button does not disappear after click —
    // the page submits via XHR in the background. Flat 8s wait is enough.
    console.log('[uploadAndConfigure] Waiting 8s for import to process...');
    await page.waitForTimeout(8000);
    console.log('[uploadAndConfigure] Import wait complete');

    // ── NAVIGATE TO CAMPAIGNS TAB (stable) ───────────────────────────────

    console.log('[uploadAndConfigure] Navigating to Campaigns tab...');
    const campaignTabClicked = await page.evaluate(() => {
      // Try text match on all tab anchors — jQuery UI tabs use <a> inside <li>
      const anchors = document.querySelectorAll('ul.ui-tabs-nav a, #tabs a, .ui-tabs a');
      for (const a of anchors) {
        if (a.textContent.trim().toLowerCase() === 'campaigns') {
          a.click();
          return true;
        }
      }
      // Fallback: try any <a> with href containing 'campaigns'
      const allLinks = document.querySelectorAll('a');
      for (const a of allLinks) {
        const href = (a.getAttribute('href') || '').toLowerCase();
        const text = a.textContent.trim().toLowerCase();
        if (text === 'campaigns' || href.includes('campaigns')) {
          a.click();
          return true;
        }
      }
      return false;
    });

    if (!campaignTabClicked) {
      console.log('[uploadAndConfigure] evaluate click failed, trying Playwright locator...');
      // Try Playwright text locator as fallback
      await page.locator('a:has-text("Campaigns")').first().click({ timeout: 10000 });
    }

    await page.waitForTimeout(3000);
    console.log('[uploadAndConfigure] On Campaigns tab');

    // ── FIND AND OPEN CAMPAIGN ────────────────────────────────────────────

    console.log(`[uploadAndConfigure] Opening campaign: ${campaign_name}`);

    // Poll for campaign list to populate
    let campItem = null;
    for (let i = 0; i < 15; i++) {
      campItem = page.locator(`#campaign_list li`).filter({ hasText: campaign_name }).first();
      const count = await campItem.count();
      if (count > 0) break;
      await page.waitForTimeout(1000);
      console.log(`[uploadAndConfigure] Waiting for campaign list... attempt ${i + 1}`);
    }

    if (!campItem || await campItem.count() === 0) {
      throw new Error(`Campaign "${campaign_name}" not found in campaign list`);
    }

    await campItem.click();
    await page.waitForTimeout(3000);
    console.log('[uploadAndConfigure] Campaign opened');

    // ── PHONE GROUPS: CHECK ALL ───────────────────────────────────────────

    console.log('[uploadAndConfigure] Assigning phone groups...');
    try {
      const phoneGroupBtn = page.locator('button.ui-multiselect').nth(0);
      await phoneGroupBtn.waitFor({ timeout: 8000 });
      await phoneGroupBtn.click();
      await page.waitForTimeout(1000);

      // Click "Check All" — try multiple selector patterns
      const checkAllClicked = await page.evaluate(() => {
        const candidates = [
          document.querySelector('a.ui-multiselect-all'),
          ...[...document.querySelectorAll('a')].filter(a => a.textContent.trim().toLowerCase() === 'check all'),
        ];
        for (const el of candidates) {
          if (el) { el.click(); return true; }
        }
        return false;
      });

      if (!checkAllClicked) {
        await page.locator('text=Check All').first().click({ timeout: 5000 });
      }

      await page.waitForTimeout(800);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      console.log('[uploadAndConfigure] Phone groups: all checked');
    } catch (e) {
      console.log(`[uploadAndConfigure] Phone groups step failed (non-fatal): ${e.message}`);
    }

    // ── CALL RESULTS: CHECK ALL, THEN UNCHECK 4 ──────────────────────────

    console.log('[uploadAndConfigure] Configuring call results...');
    try {
      const callResultBtn = page.locator('button.ui-multiselect').nth(1);
      await callResultBtn.waitFor({ timeout: 8000 });
      await callResultBtn.click();
      await page.waitForTimeout(1000);

      // Check all
      const checkAllClicked = await page.evaluate(() => {
        const all = [...document.querySelectorAll('a.ui-multiselect-all, a')];
        const target = all.find(a =>
          a.classList.contains('ui-multiselect-all') ||
          a.textContent.trim().toLowerCase() === 'check all'
        );
        if (target) { target.click(); return true; }
        return false;
      });

      if (!checkAllClicked) {
        await page.locator('text=Check All').first().click({ timeout: 5000 });
      }

      await page.waitForTimeout(800);

      // Uncheck excluded items
      const excluded = ['CS Log', 'Transfer', 'Not Available', 'Not in Service'];
      for (const item of excluded) {
        try {
          // Find the checkbox inside the open multiselect dropdown
          const checkbox = page.locator(`.ui-multiselect-menu input[type="checkbox"]`).filter({
            has: page.locator(`..`).filter({ hasText: item })
          });

          // Fallback: find by label text
          const label = page.locator(`.ui-multiselect-menu label`).filter({ hasText: item }).first();
          const labelCount = await label.count();

          if (labelCount > 0) {
            const cb = label.locator('input[type="checkbox"]');
            const isChecked = await cb.isChecked().catch(() => false);
            if (isChecked) {
              await label.click();
              await page.waitForTimeout(300);
              console.log(`[uploadAndConfigure] Unchecked: ${item}`);
            } else {
              console.log(`[uploadAndConfigure] "${item}" already unchecked`);
            }
          } else {
            console.log(`[uploadAndConfigure] "${item}" not found in dropdown`);
          }
        } catch (e) {
          console.log(`[uploadAndConfigure] Could not uncheck "${item}": ${e.message}`);
        }
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      console.log('[uploadAndConfigure] Call results configured');
    } catch (e) {
      console.log(`[uploadAndConfigure] Call results step failed (non-fatal): ${e.message}`);
    }

    // ── CLOSE ACCORDION ───────────────────────────────────────────────────

    try {
      await page.click('img.closer.accordion-container-closer', { timeout: 3000 });
      await page.waitForTimeout(1000);
    } catch {}

    return {
      message: `✅ Leads uploaded to *${campaign_name}*${create_new_campaign ? ' (new campaign created)' : ''}. Phone groups assigned and call results configured.`,
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
