const { getStagehand } = require('../stagehand');

async function setDialerSpeed({ member_name, speed }) {
  if (!member_name) throw new Error('member_name is required.');
  const speedNum = Number(speed);
  if (isNaN(speedNum)) throw new Error('speed must be a number.');

  const { stagehand, page } = await getStagehand();
  try {
    // Click View Main
    await page.click('text=View Main');
    await page.waitForTimeout(2000);

    // Click Members tab
    await page.click('#ui-id-3');
    await page.waitForTimeout(2000);

    console.log(`[setDialerSpeed] Looking for user: ${member_name}`);

    let found = false;

    // Loop through pages
    while (!found) {
      // Scroll through current page looking for user
      for (let i = 0; i < 10; i++) {
        const userRow = page.locator(`tr:has-text("${member_name}")`).first();
        if (await userRow.isVisible()) {
          found = true;

          // Hover over their CPA value
          const cpaElement = userRow.locator('td:has-text("CPA")').first();
          await cpaElement.hover();
          await page.waitForTimeout(1000);

          // Click the target speed from dropdown
          await page.click(`text=${speedNum} CPA`);
          await page.waitForTimeout(2000);
          break;
        }
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(500);
      }

      if (found) break;

      // Try to go to next page
      const nextButton = page.locator('text=Next, a:has-text("Next"), button:has-text("Next"), [aria-label="Next page"]').first();
      const nextVisible = await nextButton.isVisible().catch(() => false);
      if (nextVisible) {
        console.log('[setDialerSpeed] Going to next page...');
        await nextButton.click();
        await page.waitForTimeout(2000);
      } else {
        throw new Error(`User "${member_name}" not found in Members list`);
      }
    }

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
