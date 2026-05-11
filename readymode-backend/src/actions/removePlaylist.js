const { getStagehand } = require('../stagehand');

// SOP Procedure G: Remove a user playlist
async function removePlaylist({ member_name }) {
  if (!member_name) throw new Error('member_name is required.');

  const { stagehand, page } = await getStagehand();
  try {
    await stagehand.act({ action: 'Click View Main to return to the main Readymode view' });
    await stagehand.act({ action: 'Navigate to the Members or Playlist area' });
    await stagehand.act({ action: `Find the playlist or member named "${member_name}". Be careful not to select a similarly named playlist.` });
    await stagehand.act({ action: `Click Remove This Playlist for the playlist named "${member_name}"` });
    await stagehand.act({ action: 'A confirmation prompt appeared — verify the name is correct, then click OK' });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ type: 'png' });
    return {
      message: `Playlist for *${member_name}* has been removed.`,
      screenshot,
    };
  } finally {
    await stagehand.close();
  }
}

module.exports = { removePlaylist };
