const { getStagehand } = require('../stagehand');

// Uses pure Playwright — no Stagehand act() needed
// SOP: View Main → Members tab → hover CPA value → select from dropdown
async function setDialerSpeed({ member_name, speed }) {
  if (!member_name) throw new Error('member_name is required.');
  const speedNum = Number(speed);
  if (isNaN(speedNum)) throw new Error('speed must be a number.');

  const { stagehand, page } = await getStagehand();
  try {
    console.log('[setDialerSpeed] Navigating to View Main...');

    // Click View Main
    await page.click('text=View Main');
    await page.waitForTimeout(2000);

    // Click Members tab
    await page.click('text=Members');
    await page.waitForTimeout(2000);

    console.log(`[setDialerSpeed] Looking for user: ${member_name}`);

    // Find the user row containing their name
    const userRow = await page.locator(`tr:has-text("${member_name}")`).first();
    await userRow.waitFor({ timeout: 10000 });

    // Find the CPA element in that row and hover over it
    const cpaElement = await userRow.locator('text=/\\d+ CPA/').first();
    await cpaElement.hover();
    await page.waitForTimeout(1000);

    // Click the target speed from dropdown
    await page.click(`text=${speedNum} CPA`);
    await page.waitForTimeout(2000);

    console.log(`[setDialerSpeed] Speed set to ${speedNum} CPA`);
    const screenshot = await page.screenshot({ type: 'png' });

    return {
      message: `Dialer speed for *${member_name}* set to *${speedNum} CPA*.`,
      screenshot,
    };
  } finally {
    await stagehand.close();
  }
}

module.exports = { setDialerSpeed };
