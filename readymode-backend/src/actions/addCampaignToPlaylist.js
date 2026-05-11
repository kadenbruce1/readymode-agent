const { getStagehand } = require('../stagehand');

// SOP Procedure C: Add a campaign to an existing member's playlist
async function addCampaignToPlaylist({ member_name, campaign_name }) {
  if (!member_name) throw new Error('member_name is required.');
  if (!campaign_name) throw new Error('campaign_name is required.');

  const { stagehand, page } = await getStagehand();
  try {
    await stagehand.act({ action: 'Close any open popup or modal by clicking the X button if one is visible' });
    await stagehand.act({ action: 'Click View Main to return to the main Readymode view' });
    await stagehand.act({ action: 'Click on Members in the navigation' });
    await stagehand.act({ action: `Find the member named "${member_name}" in the members list. If not visible, scroll down. If still not found, go to the next page.` });
    await stagehand.act({ action: `Click on the member named "${member_name}"` });
    await stagehand.act({ action: 'Click Edit This Playlist' });
    await stagehand.act({ action: 'Click Campaign to open the campaign list' });
    await stagehand.act({ action: `Find the campaign named "${campaign_name}" and drag it into the active playlist area` });
    await stagehand.act({ action: 'Click Save to save the playlist' });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ type: 'png' });
    return {
      message: `Campaign *${campaign_name}* added to *${member_name}*'s playlist and saved.`,
      screenshot,
    };
  } finally {
    await stagehand.close();
  }
}

module.exports = { addCampaignToPlaylist };
