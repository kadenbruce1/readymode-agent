const { uploadLeads } = require('./actions/uploadLeads');
const { configureCampaign } = require('./actions/configureCampaign');
const { addCampaignToPlaylist } = require('./actions/addCampaignToPlaylist');
const { createPlaylist } = require('./actions/createPlaylist');
const { setStateFilter } = require('./actions/setStateFilter');
const { setDialerSpeed } = require('./actions/setDialerSpeed');
const { removePlaylist } = require('./actions/removePlaylist');

const ACTION_MAP = {
  upload_leads: uploadLeads,
  configure_campaign: configureCampaign,
  add_campaign_to_playlist: addCampaignToPlaylist,
  create_playlist: createPlaylist,
  set_state_filter: setStateFilter,
  set_dialer_speed: setDialerSpeed,
  remove_playlist: removePlaylist,
};

async function routeAction(action) {
  const { action: name, ...params } = action;
  if (name === 'unknown') throw new Error(params.message || 'I could not understand that request.');
  const handler = ACTION_MAP[name];
  if (!handler) throw new Error(`Unknown action: "${name}"`);
  console.log(`[Router] ${name}`, params);
  return await handler(params);
}

module.exports = { routeAction };
