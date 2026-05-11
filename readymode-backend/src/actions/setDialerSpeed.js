const { getStagehand } = require('../stagehand');

// SOP: View Main → Members tab → find user → hover over CPA value → select new speed
async function setDialerSpeed({ member_name, speed }) {
  if (!member_name) throw new Error('member_name is required.');
  const speedNum = Number(speed);
  if (isNaN(speedNum)) throw new Error('speed must be a number.');

  const { stagehand, page } = await getStagehand();
  try {
    // Step 1: Click View Main
    await stagehand.act({ action: 'Click on View Main' });

    // Step 2: Click Members tab
    await stagehand.act({ action: 'Click on the Members tab' });

    // Step 3: Find the user
    await stagehand.act({ action: `Find the user named "${member_name}" in the members list. Scroll down or go to the next page if not immediately visible.` });

    // Step 4: Hover over the CPA dialer speed value for that user
    await stagehand.act({ action: `Hover over the dialer speed value (shown as a number followed by CPA, for example "5 CPA") in the row for "${member_name}"` });

    // Step 5: Select new speed from dropdown
    await stagehand.act({ action: `From the dropdown that appeared, select ${speedNum} CPA` });

    await page.waitForTimeout(2000);
    const screenshot = await page.screenshot({ type: 'png' });

    return {
      message: `Dialer speed for *${member_name}* set to *${speedNum} CPA*${speedNum === 8 ? ' (slow dialing fix)' : speedNum === 5 ? ' (normal speed)' : ''}.`,
      screenshot,
    };
  } finally {
    await stagehand.close();
  }
}

module.exports = { setDialerSpeed };
