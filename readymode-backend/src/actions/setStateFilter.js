const { getStagehand } = require('../stagehand');

// SOP Procedure E: Apply state filters to an existing member's playlist
async function setStateFilter({ member_name, states }) {
  if (!member_name) throw new Error('member_name is required.');
  if (!states?.length) throw new Error('states array is required.');

  const { stagehand, page } = await getStagehand();
  try {
    await stagehand.act({ action: 'Click View Main to return to the main Readymode view' });
    await stagehand.act({ action: 'Click on Members in the navigation' });
    await stagehand.act({ action: `Find the member named "${member_name}". Scroll down or go to the next page if not immediately visible.` });
    await stagehand.act({ action: `Click on the member named "${member_name}"` });
    await stagehand.act({ action: 'Click Edit This Playlist' });
    await stagehand.act({ action: 'Click States to open the state filter area' });

    for (const state of states) {
      await stagehand.act({ action: `Find the state "${state}" in the available states list. It may appear as a full name (e.g. "South Carolina") or abbreviation (e.g. "SC"). Select it and drag it into the active filter area.` });
    }

    await stagehand.act({ action: 'Verify all required states are in the active filter area, then click Save' });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ type: 'png' });
    return {
      message: `State filter updated for *${member_name}*: ${states.join(', ')} applied and saved.`,
      screenshot,
    };
  } finally {
    await stagehand.close();
  }
}

module.exports = { setStateFilter };
