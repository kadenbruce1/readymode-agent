const { Browserbase } = require('@browserbasehq/sdk');

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
let _sessionId = null;

async function getSession() {
  if (_sessionId) {
    try {
      const s = await bb.sessions.retrieve(_sessionId);
      if (s.status === 'RUNNING') {
        console.log(`[Browserbase] Reusing session: ${_sessionId}`);
        return _sessionId;
      }
    } catch {}
    _sessionId = null;
  }

  console.log('[Browserbase] Creating new session...');
  const s = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    keepAlive: true,
  });
  _sessionId = s.id;
  console.log(`[Browserbase] Session created: ${_sessionId}`);
  return _sessionId;
}

function clearSession() {
  _sessionId = null;
}

module.exports = { getSession, clearSession };
