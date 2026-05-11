const { getStagehand } = require('../stagehand');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// SOP Procedure A: Upload leads via Leads > Upload Leads
async function uploadLeads({ campaign_name, file_url, create_new_campaign = false }) {
  if (!campaign_name) throw new Error('campaign_name is required.');
  if (!file_url) throw new Error('file_url is required.');

  const tempPath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
  await new Promise((resolve, reject) => {
    const protocol = file_url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(tempPath);
    protocol.get(file_url, res => { res.pipe(file); file.on('finish', () => { file.close(); resolve(); }); }).on('error', reject);
  });

  const { stagehand, page } = await getStagehand();
  try {
    await stagehand.act({ action: 'Click on Leads in the left-side navigation menu' });
    await stagehand.act({ action: 'Click on Upload Leads' });

    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(tempPath);
    } else {
      await stagehand.act({ action: 'Find the file upload area and upload the CSV file' });
    }

    await stagehand.act({ action: 'Click OK or Continue to proceed after selecting the file' });
    await page.waitForTimeout(2000);
    await stagehand.act({ action: 'Map the CSV fields: match first name to the first name field, last name to last name, phone number to the primary phone field, and state to the state field' });

    if (create_new_campaign) {
      await stagehand.act({ action: 'Click Add a New Campaign' });
      await stagehand.act({ action: 'Click Add a New Campaign again to confirm' });
      await stagehand.act({ action: `Type the campaign name: ${campaign_name}` });
    } else {
      await stagehand.act({ action: `Find and select the existing campaign named "${campaign_name}"` });
    }

    await stagehand.act({ action: 'Click Import Leads to complete the upload' });
    await page.waitForTimeout(3000);

    const screenshot = await page.screenshot({ type: 'png' });
    return {
      message: `Leads uploaded to *${campaign_name}*${create_new_campaign ? ' (new campaign created)' : ''}. Remember to configure the campaign (DIDs, script, call results).`,
      screenshot,
    };
  } finally {
    await stagehand.close();
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

module.exports = { uploadLeads };
