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

      // Find the name anchor with exact text
      const nameAnchor = page.locator(`a.dp_profile_anchor_title:has-text("${member_name}")`).first();
      const isVisible = await nameAnchor.isVisible().catch(() => false);

      if (isVisible) {
        found = true;
        console.log(`[setDialerSpeed] Found ${member_name}`);

        // Get the dpid from this anchor
        const dpid = await nameAnchor.getAttribute('dpid');
        console.log(`[setDialerSpeed] dpid: ${dpid}`);

        // Hover over the CPA anchor for this user (same dpid)
        const cpaAnchor = page.locator(`a.dp_profile_anchor[dp="${dpid}"]`).first();
        await cpaAnchor.scrollIntoViewIfNeeded();
        await cpaAnchor.hover();
        await page.waitForTimeout(1000);

        // Click the speed option from the dropdown
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
