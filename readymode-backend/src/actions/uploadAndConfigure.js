const { getStagehand } = require('../stagehand');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const express = require('express');

async function uploadAndConfigure({ campaign_name, file_url, create_new_campaign = false }) {
  if (!campaign_name) throw new Error('campaign_name is required.');
  if (!file_url) throw new Error('file_url is required.');

  // ── DOWNLOAD FILE FROM SLACK ──────────────────────────────────────────

  const tempPath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
  await downloadFile(file_url, tempPath);

  const fileSize = fs.statSync(tempPath).size;
  console.log(`[uploadAndConfigure] Downloaded file size: ${fileSize} bytes`);
  if (fileSize < 100) throw new Error(`Downloaded file too small (${fileSize} bytes)`);

  // ── SERVE FILE LOCALLY SO BROWSERBASE CAN FETCH IT ───────────────────

  // Browserbase can't access Render's filesystem directly.
  // Serve the CSV on a local port so the browser can fetch it via HTTP.
  const fileToken = `file-${Date.now()}`;
  const servePort = 10001;
  const app = express();
  app.get(`/${fileToken}`, (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(tempPath);
  });
  const server = app.listen(servePort);
  console.log(`[uploadAndConfigure] Serving file at http://localhost:${servePort}/${fileToken}`);

  const { stagehand, page } = await getStagehand();

  try {

    // ── NAVIGATE TO READYMODE ─────────────────────────────────────────────

    console.log('[uploadAndConfigure] Navigating to Readymode...');
    await page.goto(process.env.READYMODE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // ── OPEN LEAD MANAGEMENT PANEL ────────────────────────────────────────

    console.log('[uploadAndConfigure] Opening Lead Management panel...');
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

    // ── INJECT FILE INTO INPUT VIA FETCH ─────────────────────────────────

    // Instead of using fileChooser (which opens a native OS dialog),
    // fetch the CSV from our local server and programmatically assign
    // it to the file input element.
    console.log('[uploadAndConfigure] Injecting file via fetch...');

    // Get the Render server's public URL for Browserbase to reach
    const renderUrl = process.env.RENDER_EXTERNAL_URL || `https://readymode-agent.onrender.com`;
    const publicFileUrl = `${renderUrl}/tmp-file/${fileToken}`;

    // Register a temp route on the main express app isn't possible here,
    // so instead we'll use base64 encoding to pass the file content directly
    const fileBuffer = fs.readFileSync(tempPath);
    const base64Content = fileBuffer.toString('base64');
    const fileName = path.basename(tempPath);

    const injected = await page.evaluate(async ({ b64, name }) => {
      try {
        // Decode base64 to binary
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'text/csv' });
        const file = new File([blob], name, { type: 'text/csv' });

        // Find the file input
        const input = document.querySelector('#leadsendform input[type="file"]') ||
                      document.querySelector('input[type="file"]');
        if (!input) return 'ERROR: no file input found';

        // Use DataTransfer to assign file to input
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;

        // Trigger change event
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return `OK: assigned ${file.name} (${file.size} bytes) to input`;
      } catch (e) {
        return `ERROR: ${e.message}`;
      }
    }, { b64: base64Content, name: fileName });

    console.log(`[uploadAndConfigure] File injection: ${injected}`);

    if (injected.startsWith('ERROR')) {
      throw new Error(`File injection failed: ${injected}`);
    }

    // ── WAIT FOR CAMPAIGN DROPDOWN TO POPULATE ────────────────────────────

    console.log('[uploadAndConfigure] Waiting for confirmation screen...');
    await page.waitForFunction(() => {
      const s = document.querySelector('select[listof="campaigns"]');
      return s && s.options.length > 1;
    }, { timeout: 60000 });
    console.log('[uploadAndConfigure] Confirmation screen loaded');
    await page.waitForTimeout(500);

    // ── SELECT CAMPAIGN ───────────────────────────────────────────────────

    console.log(`[uploadAndConfigure] Selecting campaign: ${campaign_name}`);
    const campaignSelected = await page.evaluate((name) => {
      const select = document.querySelector('select[listof="campaigns"]');
      if (!select) return 'ERROR: select not found';
      const options = Array.from(select.options);
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

    // ── CLICK DONE - IMPORT LEADS ─────────────────────────────────────────

    console.log('[uploadAndConfigure] Clicking Done - Import leads...');
    await page.locator('button:has-text("Done - Import leads"), input[value="Done - Import leads"]')
      .first()
      .click({ timeout: 10000 });

    console.log('[uploadAndConfigure] Waiting 8s for import to process...');
    await page.waitForTimeout(8000);
    console.log('[uploadAndConfigure] Import complete');

    return {
      message: `✅ Leads uploaded to campaign *${campaignSelected}*.`,
    };

  } finally {
    server.close();
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
