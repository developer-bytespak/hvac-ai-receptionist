#!/usr/bin/env tsx
/**
 * push-demo-config.ts
 *
 * Pushes the demo conversation flow and the demo agent to Retell, in that
 * order, because the agent has to reference the flow id.
 *
 * Endpoint paths verified against docs.retellai.com (September 2026):
 *   POST  /create-conversation-flow
 *   PATCH /update-conversation-flow/{conversation_flow_id}
 *   POST  /create-agent
 *   PATCH /update-agent/{agent_id}
 *   GET   /get-conversation-flow/{conversation_flow_id}
 *   GET   /get-agent/{agent_id}
 * Auth on all of them: Authorization: Bearer <RETELL_API_KEY>
 *
 * Placeholders substituted before the request goes out:
 *   <DEMO_HOST>             -> process.env.DEMO_HOST          (both files)
 *   <CONVERSATION_FLOW_ID>  -> the flow id, created or reused (agent only)
 *
 * Placeholders you must edit by hand in the JSON before a real push:
 *   <VOICE_ID>        resolved automatically from your account's voice list.
 *                     Override with VOICE_ID=... . Previously you had to
 *                     paste its id into retell/demo-agent.json.
 *   <DISPATCH_E164>   the number the transfer node dials, E.164, for example
 *                     +13125550137. Leave it as it is for a demo with no real
 *                     dispatch line. The transfer then fails and falls through
 *                     to the take a message path, which is itself worth
 *                     showing: the caller is never dropped.
 *
 * Created ids are written to retell/.demo-ids.json so a second run updates
 * rather than creating duplicates. That file is gitignored.
 *
 * Usage:
 *   RETELL_API_KEY=key_... DEMO_HOST=hvac-demo.onrender.com \
 *     npx tsx retell/push-demo-config.ts [--dry-run] [--allow-placeholders]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const IDS_FILE = join(HERE, ".demo-ids.json");
const FLOW_FILE = join(HERE, "demo-flow.json");
const AGENT_FILE = join(HERE, "demo-agent.json");

const BASE_URL = process.env.RETELL_BASE_URL ?? "https://api.retellai.com";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allowPlaceholders = args.includes("--allow-placeholders");

type Ids = { conversation_flow_id?: string; agent_id?: string };

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function apiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) fail("RETELL_API_KEY is not set. Copy it from the Retell dashboard under API Keys.");
  return key;
}

function demoHost(): string {
  const host = process.env.DEMO_HOST;
  if (!host) {
    fail(
      "DEMO_HOST is not set. Use the bare hostname of the deployed demo with no scheme and no " +
        "trailing slash, for example hvac-demo.onrender.com or hvac-demo.vercel.app. " +
        "For local testing, run a tunnel and use the tunnel hostname.",
    );
  }
  return host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function retell<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} returned HTTP ${res.status}: ${text.slice(0, 1500)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

function readIds(): Ids {
  if (!existsSync(IDS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(IDS_FILE, "utf8")) as Ids;
  } catch {
    console.warn(`  warning: ${IDS_FILE} is not valid JSON, starting fresh`);
    return {};
  }
}

function writeIds(ids: Ids): void {
  writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2) + "\n");
}

/** Substitutes placeholders across the whole document, then reports leftovers. */
function substitute(doc: unknown, values: Record<string, string>): { body: any; leftover: string[] } {
  let json = JSON.stringify(doc);
  for (const [tag, value] of Object.entries(values)) {
    json = json.split(`<${tag}>`).join(value);
  }
  const leftover = [...new Set(json.match(/<[A-Z][A-Z0-9_]*>/g) ?? [])];
  return { body: JSON.parse(json), leftover };
}

/** Placeholders that are safe to leave unfilled in a demo. */
const OPTIONAL_PLACEHOLDERS = new Set(["<DISPATCH_E164>"]);

function guardPlaceholders(label: string, leftover: string[]): void {
  const blocking = leftover.filter((p) => !OPTIONAL_PLACEHOLDERS.has(p));
  for (const p of leftover.filter((x) => OPTIONAL_PLACEHOLDERS.has(x))) {
    console.log(`  note: ${label} leaves ${p} unset, which is fine for a demo`);
  }
  if (!blocking.length) return;
  const msg = `${label}: unfilled placeholders ${blocking.join(", ")}`;
  if (dryRun || allowPlaceholders) {
    console.warn(`  warning: ${msg}`);
    return;
  }
  fail(`${msg}\n  Edit them in the JSON, or pass --allow-placeholders to push anyway.`);
}

type Voice = {
  voice_id: string;
  voice_name?: string;
  provider?: string;
  gender?: string;
  accent?: string;
};

/**
 * Picks a voice from the account rather than making you hunt for an id.
 *
 * Retell does not publish its voice ids, and they differ per account, so the
 * only reliable source is the account itself. Preference order is an American
 * accent from a provider likely to sit inside the BAA and the cheaper tier,
 * falling back to whatever the account offers.
 *
 * Override at any time with VOICE_ID=... or by editing the JSON.
 */
async function resolveVoice(): Promise<string | null> {
  if (process.env.VOICE_ID) {
    console.log(`- voice: using VOICE_ID from the environment, ${process.env.VOICE_ID}`);
    return process.env.VOICE_ID;
  }

  let voices: Voice[];
  try {
    const res = await retell("GET", "/list-voices");
    voices = Array.isArray(res) ? res : (res?.voices ?? []);
  } catch (err) {
    console.warn(`  warning: could not list voices, ${err instanceof Error ? err.message : "unknown error"}`);
    return null;
  }

  if (!voices.length) return null;

  const american = (v: Voice) => (v.accent ?? "").toLowerCase().includes("american");
  const cheap = (v: Voice) => {
    const p = (v.provider ?? "").toLowerCase();
    // ElevenLabs costs $0.040 a minute against $0.015 for the others, and its
    // BAA coverage through Retell is unconfirmed, so prefer the rest.
    return p && !p.includes("eleven");
  };

  const pick =
    voices.find((v) => american(v) && cheap(v)) ??
    voices.find((v) => cheap(v)) ??
    voices.find(american) ??
    voices[0];

  console.log(
    `- voice: picked ${pick.voice_id}` +
      `${pick.voice_name ? ` (${pick.voice_name}` : ""}` +
      `${pick.provider ? `, ${pick.provider}` : ""}` +
      `${pick.accent ? `, ${pick.accent}` : ""}${pick.voice_name ? ")" : ""}` +
      ` out of ${voices.length} available`,
  );
  console.log(`  to choose a different one: VOICE_ID=<id> npm run push:retell`);
  return pick.voice_id;
}

async function main(): Promise<void> {
  const host = demoHost();
  const ids = readIds();

  console.log(`${dryRun ? "[dry run] " : ""}Pushing demo config to ${BASE_URL}`);
  console.log(`  demo host: ${host}`);
  console.log(`  tool endpoint:     https://${host}/api/retell/tool`);
  console.log(`  post-call webhook: https://${host}/api/retell/post-call\n`);

  // ---------------------------------------------------------------- 1. flow
  const flowDoc = JSON.parse(readFileSync(FLOW_FILE, "utf8"));
  // A real transfer number is optional for a demo. Without one the transfer
  // node fails and falls through to take a message, which is worth showing:
  // the caller is never dropped.
  const dispatch = process.env.DISPATCH_E164;
  const flow = substitute(flowDoc, {
    DEMO_HOST: host,
    ...(dispatch ? { DISPATCH_E164: dispatch } : {}),
  });
  if (!dispatch) {
    console.log("- transfer: no DISPATCH_E164 set, the transfer node will fall through to take a message");
  }
  guardPlaceholders("demo-flow.json", flow.leftover);

  if (!dryRun) {
    if (ids.conversation_flow_id) {
      console.log(`- conversation flow: PATCH /update-conversation-flow/${ids.conversation_flow_id}`);
      const res = await retell("PATCH", `/update-conversation-flow/${ids.conversation_flow_id}`, flow.body);
      console.log(`  updated, version ${res?.version ?? "?"}`);
    } else {
      console.log("- conversation flow: POST /create-conversation-flow");
      const res = await retell("POST", "/create-conversation-flow", flow.body);
      if (!res?.conversation_flow_id) fail(`create-conversation-flow returned no id: ${JSON.stringify(res).slice(0, 400)}`);
      ids.conversation_flow_id = res.conversation_flow_id;
      writeIds(ids);
      console.log(`  created ${ids.conversation_flow_id} and recorded it in .demo-ids.json`);
    }
  } else {
    console.log(`- conversation flow: ${ids.conversation_flow_id ? "would PATCH " + ids.conversation_flow_id : "would POST create"}`);
  }

  // --------------------------------------------------------------- 2. agent
  const agentDoc = JSON.parse(readFileSync(AGENT_FILE, "utf8"));
  const voiceId = dryRun && !process.env.RETELL_API_KEY ? null : await resolveVoice();
  const agent = substitute(agentDoc, {
    DEMO_HOST: host,
    CONVERSATION_FLOW_ID: ids.conversation_flow_id ?? "<CONVERSATION_FLOW_ID>",
    ...(voiceId ? { VOICE_ID: voiceId } : {}),
  });
  guardPlaceholders("demo-agent.json", agent.leftover);

  if (!dryRun) {
    if (ids.agent_id) {
      console.log(`- agent: PATCH /update-agent/${ids.agent_id}`);
      const res = await retell("PATCH", `/update-agent/${ids.agent_id}`, agent.body);
      console.log(`  updated, version ${res?.version ?? "?"}`);
    } else {
      console.log("- agent: POST /create-agent");
      const res = await retell("POST", "/create-agent", agent.body);
      if (!res?.agent_id) fail(`create-agent returned no id: ${JSON.stringify(res).slice(0, 400)}`);
      ids.agent_id = res.agent_id;
      writeIds(ids);
      console.log(`  created ${ids.agent_id} and recorded it in .demo-ids.json`);
    }

    // Read both back so a failed push cannot look like a good one.
    const liveFlow = await retell("GET", `/get-conversation-flow/${ids.conversation_flow_id}`);
    const liveAgent = await retell("GET", `/get-agent/${ids.agent_id}`);
    console.log(
      `\n  live flow has ${liveFlow?.nodes?.length ?? "?"} nodes and ${liveFlow?.tools?.length ?? "?"} tools`,
    );
    console.log(
      `  live agent retention ${liveAgent?.data_storage_retention_days ?? "?"} days, storage ${liveAgent?.data_storage_setting ?? "?"}`,
    );
  } else {
    console.log(`- agent: ${ids.agent_id ? "would PATCH " + ids.agent_id : "would POST create"}`);
  }

  if (dryRun) {
    console.log("\nDry run only, nothing was sent.");
    return;
  }

  console.log("\nDone. Paste this into your environment and redeploy the demo:\n");
  console.log(`  NEXT_PUBLIC_RETELL_AGENT_ID=${ids.agent_id}\n`);
  console.log("Then in the Retell dashboard: buy a phone number and bind it to this agent,");
  console.log("and check that the agent is published before the demo.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
