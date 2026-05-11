const { getStagehand } = require('../stagehand');

const DEFAULT_CAMPAIGNS = ['IFWCT', 'IFW Sharp', 'Paragon CT'];

// SOP Procedure D + E: Create new playlist, add campaigns, apply state filters
async function createPlaylist({ member_name, campaigns = DEFAULT_CAMPAIGNS, states = [] }) {
  if (!member_name) throw new Error('member_name is required.');

  const { stagehand, page } = await getStagehand();
  try {
    await stagehand.act({ action: 'Click View Main to return to the main Readymode view' });
    await stagehand.act({ action: 'Navigate to the Members or Playlist area' });
    await stagehand.act({ action: 'Click Add Playlist' });
    await stagehand.act({ action: `Type the playlist name: ${member_name}` });
    await stagehand.act({ action: 'Click OK to create the playlist' });
    await stagehand.act({ action: `Find the playlist named "${member_name}" and click Edit Playlist or Edit This Playlist` });
    await stagehand.act({ action: 'Click Campaign to open the campaign selector' });

    for (const campaign of campaigns) {
      await stagehand.act({ action: `Find the campaign named "${campaign}" and drag it into the active playlist area` });
    }

    if (states.length > 0) {
      await stagehand.act({ action: 'Click States to open the state filter area' });
      for (const state of states) {
        await stagehand.act({ action: `Find the state "${state}" in the list — it may appear as a full name like "South Carolina" or an abbreviation like "SC". Select it and drag it into the active filter area.` });
      }
    }

    await stagehand.act({ action: 'Click Save to save the playlist' });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ type: 'png' });
    return {
      message: `Playlist created for *${member_name}* with campaigns: ${campaigns.join(', ')}${states.length > 0 ? `. States: ${states.join(', ')}` : ''}. Saved.`,
      screenshot,
    };
  } finally {
    await stagehand.close();
  }
}

module.exports = { createPlaylist };
