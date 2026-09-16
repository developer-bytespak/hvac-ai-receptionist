/**
 * The record of what the agent did on a call.
 *
 * Two audiences. The pipeline table drives the live trace on screen during the
 * demo. The call_events and demo_calls tables are what the contractor reviews
 * on the monthly retainer, which is the part of this job that is a service
 * rather than a piece of software.
 */

import { q } from "./db";
import { jobTypeById } from "./config";

export type PipelineStatus = "running" | "ok" | "warn" | "error";

/** Fixed order, so the trace renders as a stable ladder. */
export const PIPELINE_STEPS = [
  "call_answered",
  "intent_classified",
  "urgency_triaged",
  "service_area_checked",
  "caller_qualified",
  "client_matched",
  "job_created",
  "technician_notified",
  "caller_confirmed",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export async function logPipeline(
  callId: string,
  step: PipelineStep | string,
  status: PipelineStatus,
  detail?: string,
  durationMs?: number,
): Promise<void> {
  await q(
    `insert into pipeline_events (call_id, step, status, detail, duration_ms)
     values ($1,$2,$3,$4,$5)`,
    [callId, step, status, detail ?? null, durationMs ?? null],
  );
}

export async function logCallEvent(input: {
  callId: string;
  action: string;
  outcome: string;
  urgency?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  await q(
    `insert into call_events (call_id, action, outcome, urgency, detail)
     values ($1,$2,$3,$4,$5)`,
    [
      input.callId,
      input.action,
      input.outcome,
      input.urgency ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
    ],
  );
}

export async function touchCall(
  callId: string,
  args: { channel?: "web" | "phone"; fromNumber?: string; afterHours?: boolean } = {},
): Promise<void> {
  await q(
    `insert into demo_calls (call_id, channel, from_number, after_hours)
     values ($1,$2,$3,$4)
     on conflict (call_id) do nothing`,
    [callId, args.channel ?? "web", args.fromNumber ?? null, args.afterHours ?? false],
  );
}

export async function setCallUrgency(callId: string, urgency: string): Promise<void> {
  await q(`update demo_calls set urgency = $2 where call_id = $1`, [callId, urgency]);
}

/**
 * Records the booking and the ticket value it represents. The revenue panel
 * sums these, which is the number the owner actually cares about.
 */
export async function markBooked(callId: string, jobTypeId: string): Promise<void> {
  const ticket = jobTypeById(jobTypeId)?.typicalTicket ?? 0;
  await q(`update demo_calls set booked = true, ticket_value = $2 where call_id = $1`, [
    callId,
    ticket,
  ]);
}

export async function closeCall(callId: string, outcome: string, summary?: string): Promise<void> {
  await q(
    `update demo_calls set ended_at = now(), outcome = $2, summary = coalesce($3, summary)
     where call_id = $1`,
    [callId, outcome, summary ?? null],
  );
}
