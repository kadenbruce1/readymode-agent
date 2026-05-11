const { getStagehand } = require('../stagehand');

async function setDialerSpeed({ member_name, speed }) {
  if (!member_name) throw new Error('member_name is required.');
  const speedNum = Number(speed);
  if (isNaN(speedNum)) throw new Error('speed must be a number.');

  const { stagehand, page } = await getStagehand();
  try {
    await page.click('text=View Main');
    await page.waitForTimeout(2000);
    await page.click('#ui-id-3');
    await page.waitForTimeout(2000);

    console.log(`[setDialerSpeed] Looking for user: ${member_name}`);

    let found = false;
    let pageNum = 1;

    while (!found) {
      console.log(`[setDialerSpeed] Checking page ${pageNum}...`);
      await page.waitForTimeout(1500);

      // Check if user is on this page
      const userRow = page.locator(`tr:has-text("${member_name}")`).first();
      const isVisible = await userRow.isVisible().catch(() => false);

      if (isVisible) {
        found = true;
        console.log(`[setDialerSpeed] Found ${member_name} on page ${pageNum}`);

        // Scroll user into view
        await userRow.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        // Hover over CPA value in that row
        const cpaElement = userRow.locator('td').filter({ hasText: /^\d+ CPA$/ }).first();
        await cpaElement.hover();
        await page.waitForTimeout(1000);

        // Click the target speed
        await page.click(`text=${speedNum} CPA`);
        await page.waitForTimeout(2000);
      } else {
        // Try next page
        pageNum++;
        const nextPage = page.locator(`li.page[onclick*="${pageNum}"]`).first();
        const nextExists = await nextPage.isVisible().catch(() => false);

        if (nextExists) {
          console.log(`[setDialerSpeed] Going to page ${pageNum}...`);
          await nextPage.click();
          await page.waitForTimeout(2000);
        } else {
          throw new Error(`User "${member_name}" not found in Members list`);
        }
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
