const Browserbase = require('@browserbasehq/sdk').default || require('@browserbasehq/sdk');

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
let _sessionId = null;

async function getSession() {
  if (_sessionId) {
    try {
      const sessions = await bb.listSessions();
      const existing = sessions.find(s => s.id === _sessionId && s.status === 'RUNNING');
      if (existing) {
        console.log(`[Browserbase] Reusing session: ${_sessionId}`);
        return _sessionId;
      }
    } catch {}
    _sessionId = null;
  }

  console.log('[Browserbase] Creating new session...');
  const session = await bb.createSession({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
  });
  _sessionId = session.id;
  console.log(`[Browserbase] Session created: ${_sessionId}`);
  return _sessionId;
}

function clearSession() {
  _sessionId = null;
}

module.exports = { getSession, clearSession };
