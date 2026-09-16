/**
 * End to end check of the HVAC pipeline without Next.js, Retell or a database
 * server. Runs against PGlite, so it works on a clean machine with no accounts.
 *
 *   npx tsx tests/smoke.ts
 *
 * It walks the emergency scene the way a real call would, then the out of area
 * scene, then the estimate scene, and prints what the demo panels will show.
 */

// The emergency scene is an after hours call, so pin that regardless of when
// the test runs. The demo uses the same switch.
process.env.DEMO_FORCE_AFTER_HOURS = "true";

import { rm } from "node:fs/promises";
import { q, resetDemo } from "../lib/db";
import { runTool } from "../lib/tools";
import { jobber } from "../lib/jobber";
import type { ToolRequest } from "../lib/retell";

function call(callId: string, name: string, args: Record<string, unknown>, fromNumber?: string): ToolRequest {
  return { name, call: { call_id: callId, from_number: fromNumber }, args };
}

function heading(text: string) {
  console.log(`\n=== ${text} ===`);
}

async function main() {
  await rm(process.env.PGLITE_DIR || "./.pgdata", { recursive: true, force: true });

  heading("seed");
  await resetDemo();
  const [counts] = await q<{ clients: number; visits: number }>(
    `select (select count(*)::int from demo_clients) as clients,
            (select count(*)::int from demo_visits)  as visits`,
  );
  console.log(`gateway: ${jobber().mode}, clients ${counts.clients}, seeded visits ${counts.visits}`);
  if (counts.clients === 0 || counts.visits === 0) throw new Error("seed produced no data");

  // ---------------------------------------------------------------- scene 1
  const CALL_1 = "call_emergency_001";
  const KAREN = "+13125550188";

  heading("scene one, no heat emergency from a known customer");

  const triaged = (await runTool(
    call(CALL_1, "triage_problem", { description: "my furnace is dead and there is no heat, the house is freezing" }, KAREN),
  )) as { urgency: string; reason: string; job_type: string; dispatch_tonight: boolean; questions: string[] };
  console.log("triage:", triaged.urgency, "|", triaged.reason, "| job type:", triaged.job_type);
  if (triaged.urgency !== "emergency") throw new Error(`no heat must triage as emergency, got ${triaged.urgency}`);
  if (!triaged.questions?.length) throw new Error("emergency triage must return qualifying questions");

  const area = (await runTool(call(CALL_1, "check_service_area", { postal_code: "60004" }, KAREN))) as {
    covered: boolean;
    town?: string;
  };
  console.log("service area:", area);
  if (!area.covered) throw new Error("60004 is in the service area and must be covered");

  const customer = (await runTool(call(CALL_1, "find_or_create_customer", {}, KAREN))) as {
    status: string;
    client_id: string;
    property_id: string;
    first_name: string;
  };
  console.log("customer:", customer.status, customer.first_name);
  if (customer.status !== "existing") throw new Error("a known caller must be matched, not created again");

  const windows = (await runTool(
    call(CALL_1, "get_arrival_windows", { urgency: "emergency", job_type: triaged.job_type }, KAREN),
  )) as { windows?: { id: string; say: string }[] };
  console.log("windows offered:");
  for (const w of windows.windows ?? []) console.log("   ", w.say);
  if (!windows.windows?.length) throw new Error("expected at least one arrival window");
  if (windows.windows.length > 3) throw new Error("never offer more than three windows");

  const booked = (await runTool(
    call(
      CALL_1,
      "book_visit",
      {
        window_id: windows.windows[0].id,
        client_id: customer.client_id,
        property_id: customer.property_id,
        urgency: triaged.urgency,
        job_type: triaged.job_type,
        symptom: "Furnace not responding, no heat.",
      },
      KAREN,
    ),
  )) as { status: string; say?: string; job_id?: string };
  console.log("booked:", booked.status, "|", booked.say);
  if (booked.status !== "booked") throw new Error(`expected booked, got ${booked.status}`);

  const notified = (await runTool(
    call(CALL_1, "notify_on_call", { urgency: "emergency", summary: "No heat, Arlington Heights", window: booked.say }, KAREN),
  )) as { status: string; technician: string };
  console.log("notify:", notified);

  // The technician who is paged must be the technician who got the job, or
  // the demo contradicts itself on screen.
  if (!String(booked.say).includes(notified.technician)) {
    throw new Error(
      `paged ${notified.technician} but booked "${booked.say}". After hours emergencies must go to the on call technician.`,
    );
  }

  // ---------------------------------------------------------------- scene 2
  heading("scene two, caller outside the service area");
  const CALL_2 = "call_outofarea_002";
  await runTool(call(CALL_2, "triage_problem", { description: "no heat at all" }, "+13125550999"));
  const declined = (await runTool(call(CALL_2, "check_service_area", { postal_code: "60614" }, "+13125550999"))) as {
    covered: boolean;
    say: string;
  };
  console.log(declined);
  if (declined.covered) throw new Error("60614 must not be covered");

  // An out of area caller must still leave a trace, or the office never hears
  // about them and the contractor is back where they started.
  const message = (await runTool(
    call(CALL_2, "take_message", {
      name: "Owen Marsh",
      phone: "+13125550999",
      town: "Chicago, Lincoln Park",
      reason: "out_of_area",
      note: "No heat, wants a recommendation for someone who covers the city.",
    }, "+13125550999"),
  )) as { status: string };
  console.log("message:", message);
  if (message.status !== "recorded") throw new Error("take_message must record something");

  const queued = await q<{ n: number }>(`select count(*)::int as n from callback_queue where reason = 'out_of_area'`);
  if (queued[0].n !== 1) throw new Error("the out of area caller must land in the callback queue");

  const outOfAreaVisits = await q<{ n: number }>(
    `select count(*)::int as n from demo_visits where created_by_agent and job_id in
       (select id from demo_jobs where client_id in (select id from demo_clients where postal_code = '60614'))`,
  );
  if (outOfAreaVisits[0].n > 0) throw new Error("an out of area caller must never reach the dispatch board");

  // ---------------------------------------------------------------- scene 4
  heading("scene four, replacement estimate");
  const CALL_3 = "call_estimate_003";
  const quoteTriage = (await runTool(
    call(CALL_3, "triage_problem", { description: "I want a quote on a new furnace, mine is twenty years old" }, "+13125550142"),
  )) as { urgency: string; job_type: string };
  console.log("triage:", quoteTriage.urgency, "| job type:", quoteTriage.job_type);
  if (quoteTriage.urgency !== "quote") throw new Error(`expected quote, got ${quoteTriage.urgency}`);

  const quoteCustomer = (await runTool(call(CALL_3, "find_or_create_customer", {}, "+13125550142"))) as {
    client_id: string;
    property_id: string;
  };
  console.log(
    "estimate:",
    await runTool(
      call(CALL_3, "log_estimate_request", {
        client_id: quoteCustomer.client_id,
        property_id: quoteCustomer.property_id,
        details: "Twenty year old furnace, single family, wants replacement pricing.",
      }, "+13125550142"),
    ),
  );

  const estimateVisits = await q<{ n: number }>(
    `select count(*)::int as n from demo_visits where created_by_agent and job_id in
       (select id from demo_jobs where urgency = 'quote')`,
  );
  if (estimateVisits[0].n > 0) throw new Error("an estimate must not book a technician visit");

  // ---------------------------------------------------------------- results
  heading("dispatch board, agent created visits");
  const agentVisits = await q<{ id: string; technician_id: string; starts_at: string; urgency: string }>(
    `select id, technician_id, starts_at, urgency from demo_visits where created_by_agent order by starts_at`,
  );
  console.log(agentVisits);
  if (agentVisits.length !== 1) throw new Error(`expected exactly one agent visit, found ${agentVisits.length}`);

  heading("pipeline, scene one");
  const pipeline = await q<{ step: string; status: string; detail: string | null }>(
    `select step, status, detail from pipeline_events where call_id = $1 order by id asc`,
    [CALL_1],
  );
  for (const p of pipeline) console.log(`  ${p.status.padEnd(6)} ${p.step.padEnd(22)} ${p.detail ?? ""}`);

  heading("texts composed");
  const messages = await q<{ to_label: string; status: string; provider: string; body: string }>(
    `select to_label, status, provider, body from outbound_messages order by id asc`,
  );
  for (const m of messages) console.log(`  [${m.to_label}/${m.status}/${m.provider}] ${m.body}`);
  if (!messages.some((m) => m.to_label === "technician")) throw new Error("an after hours emergency must page the on call technician");
  if (!messages.some((m) => m.to_label === "caller")) throw new Error("the caller must get a confirmation text");

  heading("revenue panel totals");
  const [totals] = await q<{ after_hours: number; booked: number; revenue: number }>(
    `select count(*) filter (where after_hours)::int as after_hours,
            count(*) filter (where booked)::int      as booked,
            coalesce(sum(ticket_value),0)::float     as revenue
     from demo_calls`,
  );
  console.log(totals);
  if (totals.booked !== 1) throw new Error("exactly one call should be marked booked");

  console.log("\nAll checks passed.\n");
}

main().catch((err) => {
  console.error("\nSMOKE TEST FAILED\n", err);
  process.exit(1);
});
