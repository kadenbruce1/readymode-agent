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

      const userRow = page.locator(`tr:has-text("${member_name}")`).first();
      const isVisible = await userRow.isVisible().catch(() => false);

      if (isVisible) {
        found = true;
        console.log(`[setDialerSpeed] Found ${member_name} on page ${pageNum}`);

        await userRow.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        // Find the CPA anchor (dp_profile_anchor) inside this row
        const cpaAnchor = userRow.locator('a.dp_profile_anchor').first();
        await cpaAnchor.hover();
        await page.waitForTimeout(1000);

        // The dropdown menu appears — click the item matching the speed
        await page.click(`ul.dp_profile_menu li a:has-text("${speedNum} CPA")`);
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
