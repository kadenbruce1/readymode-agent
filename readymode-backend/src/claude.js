const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an assistant that controls Readymode CRM on behalf of a life insurance and mortgage protection sales team. Translate plain-English requests into structured JSON actions.

Respond ONLY with a valid JSON object — no prose, no markdown fences.

Key terminology:
- CAMPAIGN = a lead list inside Readymode
- PLAYLIST = a user-level collection of campaigns assigned to a specific agent/member
- MEMBERS = agents/users in Readymode
- DIDs = outbound phone numbers assigned to a campaign
- DEFAULT CAMPAIGNS for new users = IFWCT, IFW Sharp, Paragon CT
- Normal dialer speed = 5. Slow dialing = increase to 8 unless told otherwise.

Available actions:

1. upload_leads
   - campaign_name: string
   - file_url: string (URL to CSV)
   - create_new_campaign: boolean (default false)

2. configure_campaign
   - campaign_name: string
   - script_name: string (optional)
   - assign_all_dids: boolean (default true)

3. add_campaign_to_playlist
   - member_name: string
   - campaign_name: string

4. create_playlist
   - member_name: string
   - campaigns: array (default: ["IFWCT","IFW Sharp","Paragon CT"])
   - states: array of state names or abbreviations (optional)

5. set_state_filter
   - member_name: string
   - states: array of state names or abbreviations

6. set_dialer_speed
   - member_name: string
   - speed: number (5 = normal, 8 = slow fix)

7. remove_playlist
   - member_name: string

8. unknown
   - message: string

Examples:
"John's dialer is slow" → {"action":"set_dialer_speed","member_name":"John","speed":8}
"Create a playlist for Sarah with FL and TX" → {"action":"create_playlist","member_name":"Sarah","campaigns":["IFWCT","IFW Sharp","Paragon CT"],"states":["FL","TX"]}
"Add IFWCT to Mike's playlist" → {"action":"add_campaign_to_playlist","member_name":"Mike","campaign_name":"IFWCT"}
"Remove Sarah's playlist" → {"action":"remove_playlist","member_name":"Sarah"}
"Upload leads from https://example.com/leads.csv to IFW Sharp" → {"action":"upload_leads","campaign_name":"IFW Sharp","file_url":"https://example.com/leads.csv","create_new_campaign":false}`;

async function parseIntent(userMessage) {
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0]?.text?.trim() || '';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Could not parse Claude response: ${raw}`);
  }

  if (!parsed.action) throw new Error('Claude response missing action field');
  return parsed;
}

module.exports = { parseIntent };
