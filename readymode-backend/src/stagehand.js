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
      enableCaching: false,
      modelName: 'claude-opus-4-5',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    await stagehand.init();
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

  try {
    await page.check('#login_as_admin');
    console.log('[Stagehand] Checked Sign in as Admin');
  } catch (e) {
    console.log('[Stagehand] Could not check admin checkbox:', e.message);
  }

  await page.click('input[type="submit"]');

  try {
    await page.waitForSelector('input[value="Continue"]', { timeout: 5000 });
    await page.click('input[value="Continue"]');
    console.log('[Stagehand] Clicked Continue on already-logged-in dialog');
  } catch {}

  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 30000 });
  console.log(`[Stagehand] Logged in — now at: ${page.url()}`);
}

module.exports = { getStagehand };
