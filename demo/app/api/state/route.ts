/**
 * Everything the demo screen needs, in one poll.
 *
 * The browser sends the highest id it has already seen, so rows come back only
 * when they are new and the panels append rather than redraw. Polling rather
 * than a socket is deliberate: it survives a cold start, a conference network
 * and a laptop waking from sleep, which is the situation a live demo runs in.
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import {
  BUSINESS_HOURS,
  COMPANY,
  DAY_END_HOUR,
  DAY_START_HOUR,
  JOB_TYPES,
  SERVICE_AREA,
  TECHNICIANS,
  isAfterHours,
  onCallTechnician,
} from "@/lib/config";
import { jobber } from "@/lib/jobber";
import { smsMode } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(value: string | null, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sincePipeline = num(params.get("pipeline"));
  const sinceEvents = num(params.get("events"));
  const sinceMessages = num(params.get("messages"));
  const sinceCallbacks = num(params.get("callbacks"));
  const dayOffset = num(params.get("day"), 0);

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() + dayOffset);

  const [visits, pipeline, events, messages, callbacks, calls, totals] = await Promise.all([
    jobber().listVisits({ fromDate: from, days: 1 }),
    q(
      `select id, occurred_at, call_id, step, status, detail, duration_ms
       from pipeline_events where id > $1 order by id asc limit 200`,
      [sincePipeline],
    ),
    q(
      `select id, occurred_at, call_id, action, outcome, urgency, detail
       from call_events where id > $1 order by id asc limit 200`,
      [sinceEvents],
    ),
    q(
      `select id, created_at, call_id, to_number, to_label, body, status, provider
       from outbound_messages where id > $1 order by id asc limit 50`,
      [sinceMessages],
    ),
    q(
      `select id, created_at, call_id, caller_name, caller_phone, town, reason, note, handled_at
       from callback_queue where id > $1 order by id asc limit 50`,
      [sinceCallbacks],
    ),
    q(
      `select call_id, started_at, ended_at, channel, from_number, urgency,
              outcome, after_hours, booked, ticket_value, summary
       from demo_calls order by started_at desc limit 10`,
    ),
    q(
      `select
         (select count(*)::int from demo_calls)                                  as calls_total,
         (select count(*)::int from demo_calls where after_hours)                as calls_after_hours,
         (select count(*)::int from demo_calls where booked)                     as jobs_booked,
         (select coalesce(sum(ticket_value),0)::float from demo_calls where booked) as revenue_booked,
         (select count(*)::int from demo_visits where created_by_agent and status <> 'cancelled') as visits_by_agent,
         (select count(*)::int from outbound_messages)                           as messages_total,
         (select count(*)::int from callback_queue where handled_at is null)      as callbacks_open`,
    ),
  ]);

  return NextResponse.json({
    company: {
      name: COMPANY.name,
      shortName: COMPANY.shortName,
      tagline: COMPANY.tagline,
      mainNumber: COMPANY.mainNumber,
    },
    mode: {
      // Shown in the header so nobody has to guess what is live.
      jobber: jobber().mode,
      sms: smsMode(),
      afterHours: isAfterHours(),
      onCall: onCallTechnician().firstName,
      phoneNumber: process.env.NEXT_PUBLIC_DEMO_PHONE_NUMBER ?? "",
    },
    board: {
      dayOffset,
      date: from.toISOString(),
      startHour: DAY_START_HOUR,
      endHour: DAY_END_HOUR,
      hours: BUSINESS_HOURS,
      technicians: TECHNICIANS.map((t) => ({
        id: t.id,
        name: t.name,
        firstName: t.firstName,
        tone: t.tone,
        onCall: onCallTechnician().id === t.id,
      })),
      jobTypes: JOB_TYPES.map((j) => ({ id: j.id, name: j.name, minutes: j.minutes, urgency: j.urgency })),
      serviceArea: SERVICE_AREA,
    },
    visits,
    pipeline,
    events,
    messages,
    callbacks,
    calls,
    totals: totals[0] ?? {
      calls_total: 0,
      calls_after_hours: 0,
      jobs_booked: 0,
      revenue_booked: 0,
      visits_by_agent: 0,
      messages_total: 0,
      callbacks_open: 0,
    },
    cursors: {
      pipeline: pipeline.length ? Number(pipeline[pipeline.length - 1].id) : sincePipeline,
      events: events.length ? Number(events[events.length - 1].id) : sinceEvents,
      messages: messages.length ? Number(messages[messages.length - 1].id) : sinceMessages,
      callbacks: callbacks.length ? Number(callbacks[callbacks.length - 1].id) : sinceCallbacks,
    },
  });
}
