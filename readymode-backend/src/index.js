require('dotenv').config();
const { App, ExpressReceiver } = require('@slack/bolt');
const { parseIntent } = require('./claude');
const { routeAction } = require('./router');

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// ── Health check ─────────────────────────────────────────────────────────
receiver.router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ── Message handler ───────────────────────────────────────────────────────
app.message(async ({ message, client }) => {
  if (message.subtype || message.bot_id) return;

  const channelFilter = process.env.SLACK_CHANNEL_ID;
  if (channelFilter && message.channel !== channelFilter) return;

  const text = (message.text || '').trim();
  if (!text) return;

  console.log(`[Slack] "${text}"`);

  // Post acknowledgement immediately
  await client.chat.postMessage({
    channel: message.channel,
    thread_ts: message.ts,
    text: `⏳ On it! Let me take care of that now...`,
  });

  try {
    // Parse intent with Claude
    const action = await parseIntent(text);
    console.log('[Claude] Action:', JSON.stringify(action));

    // Execute the action in Browserbase
    const result = await routeAction(action);

    // Reply with result
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: `✅ ${result.message}`,
    });

  } catch (err) {
    console.error('[Error]', err.message);
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: `❌ Something went wrong: \`${err.message}\``,
    });
  }
});

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡ Readymode Slack Agent running on port ${port}`);
})();
