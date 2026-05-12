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

// ── In-memory conversation state ──────────────────────────────────────────
const conversations = {};

receiver.router.get('/health', (req, res) => res.json({ status: 'ok' }));

app.message(async ({ message, client }) => {
  if (message.subtype === 'bot_message' || message.bot_id) return;

  const channelFilter = process.env.SLACK_CHANNEL_ID;
  if (channelFilter && message.channel !== channelFilter) return;

  const text = (message.text || '').trim();
  const files = message.files || [];
  const lower = text.toLowerCase();

  console.log(`[Slack] "${text}" | files: ${files.length}`);

  // ── Reply inside an active upload conversation ────────────────────────
  if (message.thread_ts && conversations[message.thread_ts]) {
    const convo = conversations[message.thread_ts];

    // They should reply with campaign name + CSV attached
    const csvFile = files.find(f => f.name?.endsWith('.csv') || f.mimetype?.includes('csv'));

    if (!csvFile) {
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.thread_ts,
        text: `Please make sure to attach the CSV file along with the campaign name.`,
      });
      return;
    }

    if (!text) {
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.thread_ts,
        text: `Please include the campaign name in your message along with the CSV.`,
      });
      return;
    }

    // Got both — execute
    delete conversations[message.thread_ts];

    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.thread_ts,
      text: `⏳ On it! Uploading *${csvFile.name}* now...`,
    });

    try {
      const action = await parseIntent(text + ` [CSV attached: ${csvFile.name}]`);
      const { uploadAndConfigure } = require('./actions/uploadAndConfigure');
      const result = await uploadAndConfigure({
        campaign_name: action.campaign_name,
        file_url: csvFile.url_private_download,
        create_new_campaign: action.create_new_campaign || false,
      });

      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.thread_ts,
        text: `✅ ${result.message}`,
      });
    } catch (err) {
      console.error('[Upload Error]', err.message);
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.thread_ts,
        text: `❌ Something went wrong: \`${err.message}\``,
      });
    }
    return;
  }

  // ── User says "upload leads" — start conversation ─────────────────────
  if (lower.includes('upload leads') || lower.includes('upload lead')) {
    conversations[message.ts] = { channel: message.channel };

    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: `📋 Please reply with the campaign name and attach the CSV file in the same message.\n\nFor example: *"Kaden LTFC"* (with CSV attached)`,
    });
    return;
  }

  // ── Regular message ───────────────────────────────────────────────────
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
