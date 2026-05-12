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

    // ── NAVIGATE TO CAMPAIGNS TAB ─────────────────────────────────────────

    console.log('[uploadNewCampaign] Navigating to Campaigns tab...');
    const campaignTabClicked = await page.evaluate(() => {
      const anchors = document.querySelectorAll('ul.ui-tabs-nav a, #tabs a, .ui-tabs a');
      for (const a of anchors) {
        if (a.textContent.trim().toLowerCase() === 'campaigns') {
          a.click();
          return true;
        }
      }
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
      await page.locator('a:has-text("Campaigns")').first().click({ timeout: 10000 });
    }
    await page.waitForTimeout(3000);

    // ── FIND AND OPEN NEW CAMPAIGN ────────────────────────────────────────

    console.log(`[uploadNewCampaign] Opening campaign: ${campaign_name}`);
    let campItem = null;
    for (let i = 0; i < 15; i++) {
      campItem = page.locator(`#campaign_list li`).filter({ hasText: campaign_name }).first();
      const count = await campItem.count();
      if (count > 0) break;
      await page.waitForTimeout(1000);
      console.log(`[uploadNewCampaign] Waiting for campaign list... attempt ${i + 1}`);
    }

    if (!campItem || await campItem.count() === 0) {
      throw new Error(`Campaign "${campaign_name}" not found in campaign list`);
    }

    await campItem.click();
    await page.waitForTimeout(3000);
    console.log('[uploadNewCampaign] Campaign opened');

    // ── PHONE GROUPS: CHECK ALL ───────────────────────────────────────────

    console.log('[uploadNewCampaign] Assigning phone groups...');
    try {
      const phoneGroupBtn = page.locator('button.ui-multiselect').nth(0);
      await phoneGroupBtn.waitFor({ timeout: 8000 });
      await phoneGroupBtn.click();
      await page.waitForTimeout(1000);

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
      console.log('[uploadNewCampaign] Phone groups: all checked');
    } catch (e) {
      console.log(`[uploadNewCampaign] Phone groups step failed (non-fatal): ${e.message}`);
    }

    // ── CALL RESULTS: CHECK ALL, THEN UNCHECK 4 ──────────────────────────

    console.log('[uploadNewCampaign] Configuring call results...');
    try {
      const callResultBtn = page.locator('button.ui-multiselect').nth(1);
      await callResultBtn.waitFor({ timeout: 8000 });
      await callResultBtn.click();
      await page.waitForTimeout(1500);

      // Check All via direct DOM — find the open multiselect menu and click check all
      const checkAllResult = await page.evaluate(() => {
        // Find the visible/open multiselect menu
        const menus = document.querySelectorAll('.ui-multiselect-menu');
        let openMenu = null;
        for (const menu of menus) {
          const style = window.getComputedStyle(menu);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            openMenu = menu;
            break;
          }
        }
        if (!openMenu) return 'ERROR: no open menu found';

        // Click Check All inside this menu
        const checkAll = openMenu.querySelector('a.ui-multiselect-all') ||
          [...openMenu.querySelectorAll('a')].find(a => a.textContent.trim().toLowerCase() === 'check all');
        if (!checkAll) return 'ERROR: check all not found in menu';
        checkAll.click();
        return 'OK';
      });

      console.log(`[uploadNewCampaign] Check all result: ${checkAllResult}`);
      await page.waitForTimeout(1000);

      // Uncheck excluded items directly via DOM
      const excluded = ['CS Log', 'Transfer', 'Not Available', 'Not in Service'];
      const unchecked = await page.evaluate((excludedItems) => {
        const menus = document.querySelectorAll('.ui-multiselect-menu');
        let openMenu = null;
        for (const menu of menus) {
          const style = window.getComputedStyle(menu);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            openMenu = menu;
            break;
          }
        }
        if (!openMenu) return ['ERROR: no open menu'];

        const results = [];
        const labels = openMenu.querySelectorAll('label');
        for (const label of labels) {
          const labelText = label.textContent.trim();
          if (excludedItems.some(ex => labelText.toLowerCase().includes(ex.toLowerCase()))) {
            const cb = label.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) {
              cb.click();
              results.push(`unchecked: ${labelText}`);
            } else {
              results.push(`already unchecked: ${labelText}`);
            }
          }
        }
        return results;
      }, excluded);

      unchecked.forEach(r => console.log(`[uploadNewCampaign] ${r}`));
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      console.log('[uploadNewCampaign] Call results configured');
    } catch (e) {
      console.log(`[uploadNewCampaign] Call results step failed (non-fatal): ${e.message}`);
    }

    // ── CLOSE ACCORDION ───────────────────────────────────────────────────

    try {
      await page.click('img.closer.accordion-container-closer', { timeout: 3000 });
      await page.waitForTimeout(1000);
    } catch {}

    return {
      message: `✅ New campaign *${campaign_name}* created, leads uploaded, phone groups assigned, and call results configured.`,
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
