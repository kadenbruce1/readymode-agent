const { Stagehand } = require('@browserbasehq/stagehand');
const { getSession, clearSession } = require('./browserbase');

async function getStagehand() {
  let sessionId = await getSession();
  let retried = false;

  while (true) {
    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      browserbaseSessionID: sessionId,
      verbose: 1,
    });

    await stagehand.init({ modelName: 'claude-opus-4-5' });
    const page = stagehand.page;
    const url = page.url();
    const needsLogin = !url || url.includes('/login') || url === 'about:blank';

    if (needsLogin) {
      try {
        await login(page);
      } catch (err) {
        if (!retried) {
          await stagehand.close();
          clearSession();
          sessionId = await getSession();
          retried = true;
          continue;
        }
        throw new Error(`Readymode login failed: ${err.message}`);
      }
    }

    return { stagehand, page };
  }
}

async function login(page) {
  const loginUrl = `${process.env.READYMODE_URL}/login_new/`;
  console.log(`[Stagehand] Logging in at ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: 'networkidle' });
  await page.fill('#login-account', process.env.READYMODE_USERNAME);
  await page.fill('input[type="password"]', process.env.READYMODE_PASSWORD);
  await page.click('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Login")');

  // Handle "already logged in" popup — click Continue
  try {
    await page.waitForSelector('button:has-text("Continue")', { timeout: 5000 });
    await page.click('button:has-text("Continue")');
    console.log('[Stagehand] Clicked Continue on already-logged-in dialog');
  } catch {}

  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 30000 });
  console.log(`[Stagehand] Logged in — now at: ${page.url()}`);
}

module.exports = { getStagehand };
