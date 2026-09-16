/**
 * The seven things the voice agent can do, and nothing else.
 *
 * Two rules hold throughout:
 *   1. A tool returns the smallest thing the agent needs to speak. Never an
 *      address, never a price it has not been told to quote, never another
 *      customer's details.
 *   2. Every call writes a pipeline step and a call event, success or failure,
 *      because the monthly retainer is built on reviewing those rows.
 *
 * The order the agent works in: triage the problem, check the postcode, ask
 * the qualifying questions, match or create the customer, offer windows, book,
 * then notify. Service area is checked before anything is created, so an out
 * of area caller never reaches dispatch.
 */

import {
  ARRIVAL_WINDOW_MINUTES,
  COMPANY,
  QUALIFYING_QUESTIONS,
  URGENCY_LABEL,
  type Urgency,
  inServiceArea,
  isAfterHours,
  jobTypeById,
  onCallTechnician,
  technicianById,
  triage,
} from "./config";
import { q } from "./db";
import { decodeSlot, jobber } from "./jobber";
import { logCallEvent, logPipeline, markBooked, setCallUrgency, touchCall } from "./ops";
import { sendMessage } from "./sms";
import type { ToolRequest } from "./retell";

export type ToolResponse = Record<string, unknown>;

/** Maps a triaged urgency onto the job type the technician will see. */
function jobTypeFor(urgency: Urgency, reason: string): string {
  if (reason.includes("gas") || reason.includes("carbon")) return "gas_safety";
  if (reason.includes("water")) return "leak";
  if (urgency === "emergency") return "no_heat";
  if (urgency === "urgent") return "no_cool";
  if (urgency === "quote") return "replacement_estimate";
  return "furnace_tuneup";
}

/** ---------------------------------------------------------------- 1 */

async function triageProblem(req: ToolRequest): Promise<ToolResponse> {
  const started = Date.now();
  const description = String(req.args.description ?? "");
  const rule = triage(description);
  const jobTypeId = jobTypeFor(rule.urgency, rule.reason);

  await setCallUrgency(req.call.call_id, rule.urgency);
  await logPipeline(
    req.call.call_id,
    "urgency_triaged",
    rule.urgency === "emergency" ? "warn" : "ok",
    `${URGENCY_LABEL[rule.urgency]}, ${rule.reason}`,
    Date.now() - started,
  );
  await logCallEvent({
    callId: req.call.call_id,
    action: "triage",
    outcome: rule.urgency,
    urgency: rule.urgency,
    detail: { reason: rule.reason, job_type: jobTypeId },
  });

  return {
    urgency: rule.urgency,
    reason: rule.reason,
    job_type: jobTypeId,
    dispatch_tonight: rule.dispatchTonight,
    // The agent reads these back one at a time.
    questions: QUALIFYING_QUESTIONS[rule.urgency],
    say:
      rule.urgency === "emergency"
        ? `I understand, ${rule.reason} is something we treat as an emergency.`
        : `Got it, that sounds like ${rule.reason}.`,
  };
}

/** ---------------------------------------------------------------- 2 */

async function checkServiceArea(req: ToolRequest): Promise<ToolResponse> {
  const started = Date.now();
  const zip = String(req.args.postal_code ?? "");
  const result = inServiceArea(zip);

  await logPipeline(
    req.call.call_id,
    "service_area_checked",
    result.covered ? "ok" : "warn",
    result.covered ? `${zip}, ${result.town}` : `${zip} is outside the service area`,
    Date.now() - started,
  );
  await logCallEvent({
    callId: req.call.call_id,
    action: "service_area",
    outcome: result.covered ? "covered" : "out_of_area",
    detail: { postal_code: zip },
  });

  if (!result.covered) {
    return {
      covered: false,
      say: result.town
        ? `We do not cover ${result.town}, so I would not want to send someone out and waste your time.`
        : "That postcode is outside the area our technicians cover.",
    };
  }

  return { covered: true, town: result.town, say: `Yes, we cover ${result.town}.` };
}

/** ---------------------------------------------------------------- 3 */

async function findOrCreateCustomer(req: ToolRequest): Promise<ToolResponse> {
  const started = Date.now();
  const phone = String(req.call.from_number ?? req.args.phone ?? "");
  const gateway = jobber();

  const existing = phone ? await gateway.findClientByPhone(phone) : null;
  if (existing) {
    await logPipeline(
      req.call.call_id,
      "client_matched",
      "ok",
      `existing customer, ${existing.firstName}`,
      Date.now() - started,
    );
    await logCallEvent({
      callId: req.call.call_id,
      action: "client_matched",
      outcome: "existing",
      detail: { source: gateway.mode },
    });
    return {
      status: "existing",
      client_id: existing.id,
      property_id: existing.propertyId,
      first_name: existing.firstName,
      say: `Good to hear from you again, ${existing.firstName}.`,
    };
  }

  const firstName = String(req.args.first_name ?? "").trim();
  const lastName = String(req.args.last_name ?? "").trim();
  const zip = String(req.args.postal_code ?? "").replace(/\D/g, "").slice(0, 5);
  const street = String(req.args.street ?? "").trim();
  const town = inServiceArea(zip).town ?? String(req.args.city ?? "");

  if (!firstName || !street || !zip) {
    await logPipeline(req.call.call_id, "client_matched", "warn", "not enough detail to create a customer");
    return { status: "need_more_detail" };
  }

  const created = await gateway.createClient({
    firstName,
    lastName: lastName || "(not given)",
    phone: phone || "+10000000000",
    address: { street1: street, city: town, province: "IL", postalCode: zip },
  });

  await logPipeline(
    req.call.call_id,
    "client_matched",
    "ok",
    `new customer created in ${gateway.mode === "live" ? "Jobber" : "the demo book"}`,
    Date.now() - started,
  );
  await logCallEvent({
    callId: req.call.call_id,
    action: "client_created",
    outcome: "created",
    detail: { source: gateway.mode },
  });

  return {
    status: "created",
    client_id: created.id,
    property_id: created.propertyId,
    first_name: created.firstName,
  };
}

/** ---------------------------------------------------------------- 4 */

async function getArrivalWindows(req: ToolRequest): Promise<ToolResponse> {
  const started = Date.now();
  const urgency = String(req.args.urgency ?? "routine");
  const jobTypeId = String(req.args.job_type ?? "furnace_tuneup");
  const type = jobTypeById(jobTypeId);

  const slots = await jobber().findOpenSlots({
    fromDate: new Date(),
    days: urgency === "emergency" ? 2 : 7,
    minutes: type?.minutes ?? 90,
    skill: type?.skill ?? "any",
    urgency,
  });

  await logPipeline(
    req.call.call_id,
    "caller_qualified",
    slots.length ? "ok" : "warn",
    `${slots.length} windows offered`,
    Date.now() - started,
  );
  await logCallEvent({
    callId: req.call.call_id,
    action: "get_windows",
    outcome: slots.length ? "ok" : "none_available",
    urgency,
    detail: { offered: slots.length },
  });

  if (!slots.length) return { status: "none_available" };

  // Only the id and the sentence. The agent does not need timestamps.
  return { windows: slots.map((s) => ({ id: s.id, say: s.say })) };
}

/** ---------------------------------------------------------------- 5 */

async function bookVisit(req: ToolRequest): Promise<ToolResponse> {
  const started = Date.now();
  const slot = decodeSlot(String(req.args.window_id ?? ""));
  const clientId = String(req.args.client_id ?? "");
  const propertyId = String(req.args.property_id ?? "");
  const urgency = String(req.args.urgency ?? "routine");
  const jobTypeId = String(req.args.job_type ?? "furnace_tuneup");
  const symptom = String(req.args.symptom ?? "").slice(0, 300);

  if (!slot || !clientId || !propertyId) {
    await logPipeline(req.call.call_id, "job_created", "error", "missing window or customer");
    return { status: "error", say: "I could not hold that window" };
  }

  const type = jobTypeById(jobTypeId);
  const end = new Date(slot.start.getTime() + (type?.minutes ?? 90) * 60_000);

  try {
    const result = await jobber().createScheduledJob({
      clientId,
      propertyId,
      title: type?.name ?? "Service call",
      instructions: symptom || "Booked by the after hours assistant.",
      jobTypeId,
      urgency,
      startAt: slot.start,
      endAt: end,
      technicianId: slot.technicianId,
      arrivalWindowMinutes: ARRIVAL_WINDOW_MINUTES,
    });

    await logPipeline(req.call.call_id, "job_created", "ok", result.say, Date.now() - started);
    await logCallEvent({
      callId: req.call.call_id,
      action: "job_created",
      outcome: "booked",
      urgency,
      detail: { job_type: jobTypeId, job_id: result.jobId },
    });
    await markBooked(req.call.call_id, jobTypeId);

    return { status: "booked", say: result.say, job_id: result.jobId };
  } catch (err) {
    // A booking that cannot land becomes a callback rather than a dead end.
    await logPipeline(
      req.call.call_id,
      "job_created",
      "error",
      err instanceof Error ? err.message : "unknown error",
    );
    await logCallEvent({
      callId: req.call.call_id,
      action: "job_created",
      outcome: "error",
      urgency,
    });
    return {
      status: "queued",
      say: "I have passed this to dispatch and they will confirm your window shortly",
    };
  }
}

/** ---------------------------------------------------------------- 6 */

async function notifyOnCall(req: ToolRequest): Promise<ToolResponse> {
  const started = Date.now();
  const urgency = String(req.args.urgency ?? "routine");
  const summary = String(req.args.summary ?? "Service call booked").slice(0, 200);
  const window = String(req.args.window ?? "");
  const callerPhone = String(req.call.from_number ?? req.args.caller_phone ?? "");

  const tech = onCallTechnician();
  const afterHours = isAfterHours();

  // The technician is only woken for work that genuinely cannot wait.
  const shouldPage = urgency === "emergency" && afterHours;

  if (shouldPage) {
    await sendMessage({
      callId: req.call.call_id,
      to: process.env.DEMO_TECHNICIAN_NUMBER || "+13125550101",
      label: "technician",
      body: `${URGENCY_LABEL[urgency as Urgency]}: ${summary}. ${window}. Booked by the after hours line.`,
    });
  }

  if (callerPhone) {
    await sendMessage({
      callId: req.call.call_id,
      to: callerPhone,
      label: "caller",
      body: `${COMPANY.shortName}: you are booked for ${window}. Reply STOP to opt out.`,
    });
  }

  await logPipeline(
    req.call.call_id,
    "technician_notified",
    "ok",
    shouldPage ? `${tech.firstName} paged, on call tonight` : "queued for the morning dispatch",
    Date.now() - started,
  );
  await logPipeline(req.call.call_id, "caller_confirmed", "ok", "confirmation text queued");
  await logCallEvent({
    callId: req.call.call_id,
    action: "notify",
    outcome: shouldPage ? "paged" : "queued",
    urgency,
    detail: { technician: tech.id },
  });

  return { status: "notified", technician: tech.firstName };
}

/** ---------------------------------------------------------------- 7 */

async function logEstimateRequest(req: ToolRequest): Promise<ToolResponse> {
  const started = Date.now();
  const clientId = String(req.args.client_id ?? "");
  const propertyId = String(req.args.property_id ?? "");
  const details = String(req.args.details ?? "").slice(0, 500);

  if (!clientId || !propertyId) {
    await logPipeline(req.call.call_id, "job_created", "warn", "estimate needs a customer first");
    return { status: "need_customer" };
  }

  const { requestId } = await jobber().createRequest({
    clientId,
    propertyId,
    title: "Replacement estimate, from the phone line",
    details,
  });

  await logPipeline(
    req.call.call_id,
    "job_created",
    "ok",
    "estimate request created for the sales team",
    Date.now() - started,
  );
  await logCallEvent({
    callId: req.call.call_id,
    action: "estimate_request",
    outcome: "created",
    urgency: "quote",
    detail: { request_id: requestId },
  });

  return {
    status: "created",
    say: "I have passed that to the team who handle replacements, and they will call you to arrange a visit",
  };
}

/** ---------------------------------------------------------------- 8 */

/**
 * The fallback that matters more than it looks. Out of area, nobody free to
 * transfer to, or a caller who just wants a call back tomorrow. Without this
 * the call ends politely and the office never hears about it, which is exactly
 * the failure the contractor is paying to remove.
 */
async function takeMessage(req: ToolRequest): Promise<ToolResponse> {
  const started = Date.now();
  const name = String(req.args.name ?? "").trim();
  const phone = String(req.args.phone ?? req.call.from_number ?? "").trim();
  const reason = String(req.args.reason ?? "callback").trim();
  const note = String(req.args.note ?? "").slice(0, 400);
  const town = String(req.args.town ?? "").trim();

  await q(
    `insert into callback_queue (call_id, caller_name, caller_phone, town, reason, note)
     values ($1,$2,$3,$4,$5,$6)`,
    [req.call.call_id, name || "(not given)", phone || "(not given)", town || null, reason, note || null],
  );

  await logPipeline(
    req.call.call_id,
    "caller_confirmed",
    "warn",
    `message taken for the office, ${reason.replace(/_/g, " ")}`,
    Date.now() - started,
  );
  await logCallEvent({
    callId: req.call.call_id,
    action: "message_taken",
    outcome: reason,
    detail: { has_number: Boolean(phone) },
  });

  return {
    status: "recorded",
    say: "I have that, and the office will call you back.",
  };
}

const HANDLERS: Record<string, (req: ToolRequest) => Promise<ToolResponse>> = {
  triage_problem: triageProblem,
  take_message: takeMessage,
  check_service_area: checkServiceArea,
  find_or_create_customer: findOrCreateCustomer,
  get_arrival_windows: getArrivalWindows,
  book_visit: bookVisit,
  notify_on_call: notifyOnCall,
  log_estimate_request: logEstimateRequest,
};

export function knownTools(): string[] {
  return Object.keys(HANDLERS);
}

export async function runTool(req: ToolRequest): Promise<ToolResponse> {
  await touchCall(req.call.call_id, {
    channel: req.call.from_number ? "phone" : "web",
    fromNumber: req.call.from_number,
    afterHours: isAfterHours(),
  });

  const handler = HANDLERS[req.name];
  if (!handler) {
    await logPipeline(req.call.call_id, "tool_unknown", "error", req.name);
    return { status: "unknown_function" };
  }

  try {
    return await handler(req);
  } catch (err) {
    await logPipeline(
      req.call.call_id,
      req.name,
      "error",
      err instanceof Error ? err.message : "unknown error",
    );
    await logCallEvent({ callId: req.call.call_id, action: req.name, outcome: "error" });
    return { status: "error", say: "I could not reach the schedule just now" };
  }
}

export { technicianById };
