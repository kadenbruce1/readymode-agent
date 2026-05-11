const { getStagehand } = require('../stagehand');

// SOP Procedure B: Assign DIDs, script, and call results after upload
async function configureCampaign({ campaign_name, script_name, assign_all_dids = true }) {
  if (!campaign_name) throw new Error('campaign_name is required.');

  const { stagehand, page } = await getStagehand();
  try {
    await stagehand.act({ action: 'Click on Campaign or Campaigns in the navigation' });
    await stagehand.act({ action: `Find and click on the campaign named "${campaign_name}"` });

    if (assign_all_dids) {
      await stagehand.act({ action: 'Find the Assigned DIDs section' });
      await stagehand.act({ action: 'Click Check All or the option that selects all available DIDs' });
      await stagehand.act({ action: 'Confirm or save the DID assignment' });
    }

    if (script_name) {
      await stagehand.act({ action: 'Find the Assigned Scripts section' });
      await stagehand.act({ action: `Select the script named "${script_name}" and assign it to the campaign` });
    }

    await stagehand.act({ action: 'Find the Assigned Call Results section' });
    await stagehand.act({ action: 'Select all available call results' });
    await stagehand.act({ action: 'Deselect or uncheck these four call results: Not in Service, Not Available, Transfer CS Log, Uncallable' });
    await stagehand.act({ action: 'Click Save to save all campaign settings' });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ type: 'png' });
    return {
      message: `Campaign *${campaign_name}* configured: all DIDs assigned${script_name ? `, script "${script_name}" assigned` : ''}, call results set (excluding: Not in Service, Not Available, Transfer CS Log, Uncallable).`,
      screenshot,
    };
  } finally {
    await stagehand.close();
  }
}

module.exports = { configureCampaign };
