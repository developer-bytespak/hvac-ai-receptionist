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
 *   <VOICE_ID>        pick one in the Retell dashboard under Voices, then
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

function guardPlaceholders(label: string, leftover: string[]): void {
  if (!leftover.length) return;
  const msg = `${label}: unfilled placeholders ${leftover.join(", ")}`;
  if (dryRun || allowPlaceholders) {
    console.warn(`  warning: ${msg}`);
    return;
  }
  fail(`${msg}\n  Edit them in the JSON, or pass --allow-placeholders to push anyway.`);
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
  const flow = substitute(flowDoc, { DEMO_HOST: host });
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
  const agent = substitute(agentDoc, {
    DEMO_HOST: host,
    CONVERSATION_FLOW_ID: ids.conversation_flow_id ?? "<CONVERSATION_FLOW_ID>",
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
