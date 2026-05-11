const { getStagehand } = require('../stagehand');

// SOP Procedure F: Adjust dialer speed for a specific member
// Normal speed = 5. Slow dialing = 8.
async function setDialerSpeed({ member_name, speed }) {
  if (!member_name) throw new Error('member_name is required.');
  const speedNum = Number(speed);
  if (isNaN(speedNum)) throw new Error('speed must be a number.');

  const { stagehand, page } = await getStagehand();
  try {
    await stagehand.act({ action: 'Click View Main to return to the main Readymode view' });
    await stagehand.act({ action: 'Click on Members in the navigation' });
    await stagehand.act({ action: `Find the member named "${member_name}". Scroll down or go to the next page if not immediately visible.` });
    await stagehand.act({ action: `Click on the member named "${member_name}" to open their settings` });
    await stagehand.act({ action: 'Find and click on Dialer Speed' });
    await stagehand.act({ action: `Set the dialer speed value to ${speedNum}` });
    await stagehand.act({ action: 'Save or confirm the dialer speed change' });
    await page.waitForTimeout(1500);

    const screenshot = await page.screenshot({ type: 'png' });
    return {
      message: `Dialer speed for *${member_name}* set to *${speedNum}*${speedNum === 8 ? ' (slow dialing fix)' : speedNum === 5 ? ' (normal speed)' : ''}.`,
      screenshot,
    };
  } finally {
    await stagehand.close();
  }
}

module.exports = { setDialerSpeed };
