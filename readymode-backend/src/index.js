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

// ── Health check ──────────────────────────────────────────────────────────
receiver.router.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Message handler ───────────────────────────────────────────────────────
app.message(async ({ message, client }) => {
  if (message.subtype === 'bot_message' || message.bot_id) return;

  const channelFilter = process.env.SLACK_CHANNEL_ID;
  if (channelFilter && message.channel !== channelFilter) return;

  const text = (message.text || '').trim();
  const files = message.files || [];

  console.log(`[Slack] "${text}" | files: ${files.length}`);

  // Check if this is a reply inside an active upload conversation
  if (message.thread_ts && conversations[message.thread_ts]) {
    await handleConversationReply(message, client, text);
    return;
  }

  // Check if a CSV file was uploaded
  if (files.length > 0 && files.some(f => f.name?.endsWith('.csv') || f.mimetype?.includes('csv'))) {
    const csvFile = files.find(f => f.name?.endsWith('.csv') || f.mimetype?.includes('csv'));
    await startUploadConversation(message, client, csvFile);
    return;
  }

  // Regular message
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

// ── Start upload conversation ─────────────────────────────────────────────
async function startUploadConversation(message, client, csvFile) {
  conversations[message.ts] = {
    channel: message.channel,
    threadTs: message.ts,
    fileUrl: csvFile.url_private_download,
    fileName: csvFile.name,
    step: 'ask_campaign_type',
  };

  await client.chat.postMessage({
    channel: message.channel,
    thread_ts: message.ts,
    text: `📁 Got the file *${csvFile.name}*!\n\nAre you uploading to a *new campaign* or an *existing campaign*? (Reply "new" or "existing")`,
  });
}

// ── Handle replies inside an upload conversation ──────────────────────────
async function handleConversationReply(message, client, text) {
  const convo = conversations[message.thread_ts];
  const lower = text.toLowerCase().trim();

  if (convo.step === 'ask_campaign_type') {
    if (lower.includes('new')) {
      convo.createNew = true;
      convo.step = 'ask_campaign_name';
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.thread_ts,
        text: `What would you like to name the new campaign?`,
      });
    } else if (lower.includes('existing')) {
      convo.createNew = false;
      convo.step = 'ask_campaign_name';
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.thread_ts,
        text: `What is the name of the existing campaign?`,
      });
    } else {
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.thread_ts,
        text: `Please reply with "new" or "existing".`,
      });
    }
    return;
  }

  if (convo.step === 'ask_campaign_name') {
    convo.campaignName = text.trim();
    convo.step = 'ask_states';
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.thread_ts,
      text: `Any state filters? List them (e.g. "FL, TX, GA") or say *no*.`,
    });
    return;
  }

  if (convo.step === 'ask_states') {
    if (lower === 'no' || lower === 'none' || lower === 'n/a') {
      convo.states = [];
    } else {
      convo.states = text.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    }

    convo.step = 'executing';
    await client.chat.postMessage({
      channel: convo.channel,
      thread_ts: convo.threadTs,
      text: `⏳ Uploading *${convo.fileName}* to *${convo.campaignName}*${convo.createNew ? ' (new campaign)' : ''}${convo.states.length > 0 ? ` | States: ${convo.states.join(', ')}` : ''}. This may take a minute...`,
    });

    try {
      const { uploadAndConfigure } = require('./actions/uploadAndConfigure');
      const result = await uploadAndConfigure({
        campaign_name: convo.campaignName,
        file_url: convo.fileUrl,
        create_new_campaign: convo.createNew,
        states: convo.states,
      });

      await client.chat.postMessage({
        channel: convo.channel,
        thread_ts: convo.threadTs,
        text: `✅ ${result.message}`,
      });
    } catch (err) {
      console.error('[Upload Error]', err.message);
      await client.chat.postMessage({
        channel: convo.channel,
        thread_ts: convo.threadTs,
        text: `❌ Something went wrong: \`${err.message}\``,
      });
    }

    delete conversations[message.thread_ts];
    return;
  }
}

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡ Readymode Slack Agent running on port ${port}`);
})();
