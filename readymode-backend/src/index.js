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

receiver.router.get('/health', (req, res) => res.json({ status: 'ok' }));

app.message(async ({ message, client }) => {
  if (message.subtype === 'bot_message' || message.bot_id) return;

  const channelFilter = process.env.SLACK_CHANNEL_ID;
  if (channelFilter && message.channel !== channelFilter) return;

  const text = (message.text || '').trim();
  const files = message.files || [];

  console.log(`[Slack] "${text}" | files: ${files.length}`);

  // ── CSV file upload — parse campaign name from message text ──────────────
  if (files.length > 0 && files.some(f => f.name?.endsWith('.csv') || f.mimetype?.includes('csv'))) {
    const csvFile = files.find(f => f.name?.endsWith('.csv') || f.mimetype?.includes('csv'));

    // Need campaign name from message text
    if (!text) {
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.ts,
        text: `📁 Got the CSV! Please re-upload it with a message telling me the campaign name. For example: *"upload to IFW Sharp"* (attach CSV)`,
      });
      return;
    }

    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: `⏳ On it! Uploading *${csvFile.name}* now...`,
    });

    try {
      // Use Claude to extract campaign name and whether it's new
      const action = await parseIntent(text + ` [CSV file attached: ${csvFile.name}]`);
      console.log('[Claude] Action:', JSON.stringify(action));

      const { uploadAndConfigure } = require('./actions/uploadAndConfigure');
      const result = await uploadAndConfigure({
        campaign_name: action.campaign_name,
        file_url: csvFile.url_private_download,
        create_new_campaign: action.create_new_campaign || false,
      });

      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.ts,
        text: `✅ ${result.message}`,
      });
    } catch (err) {
      console.error('[Upload Error]', err.message);
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.ts,
        text: `❌ Something went wrong: \`${err.message}\``,
      });
    }
    return;
  }

  // ── Regular message ───────────────────────────────────────────────────────
  await client.chat.postMessage({
    channel: message.channel,
    thread_ts: message.ts,
    text: `⏳ On it! Let me take care of that now...`,
  });

  try {
    const action = await parseIntent(text);
    console.log('[Claude] Action:', JSON.stringify(action));
    const result = await routeAction(action);
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
