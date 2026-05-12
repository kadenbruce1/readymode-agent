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

    let found = false;
    let pageNum = 1;

    while (!found) {
      console.log(`[setDialerSpeed] Checking page ${pageNum}...`);
      await page.waitForTimeout(1500);

      const userRow = page.locator(`tr:has-text("${member_name}")`).first();
      const isVisible = await userRow.isVisible().catch(() => false);

      if (isVisible) {
        found = true;
        await userRow.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        // Hover over the CPA anchor to trigger dropdown
        const cpaAnchor = userRow.locator('a.dp_profile_anchor').first();
        await cpaAnchor.hover();
        await page.waitForTimeout(1000);

        // Click the menu item with matching config value (speed number)
        await page.click(`a[role="menuitem"][config="${speedNum}"]`);
        await page.waitForTimeout(2000);

      } else {
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
