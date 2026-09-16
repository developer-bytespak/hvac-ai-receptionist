"use client";

/**
 * The single poll that feeds the whole screen.
 *
 * GET /api/state is asked roughly twice a second with the highest row id the
 * browser has already seen, so the pipeline, the call log and the texts append
 * instead of redrawing and their animations stay smooth. Visits carry no
 * cursor and are replaced wholesale, which is what lets the board show a
 * cancellation as well as a new booking.
 *
 * Polling pauses while the tab is hidden and resumes the moment it comes back,
 * and a failed fetch is swallowed and retried. A demo laptop that sleeps in the
 * middle of a meeting reconnects on its own.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 700;
const RETRY_MS = 1400;
/** Keep the appended logs bounded. A long demo should not grow without limit. */
const MAX_ROWS = 400;

/** Postgres bigserial arrives as a string over the pg driver and a number over PGlite. */
export type RowId = number | string;

export type TechnicianTone = "blue" | "rust" | "moss" | "slate";

export interface VisitRow {
  id: string;
  jobId: string;
  title: string;
  startAt: string;
  endAt: string;
  assignedTechnicianId: string;
  urgency: string;
  clientName: string;
  createdByAgent: boolean;
}

export interface PipelineRow {
  id: RowId;
  occurred_at: string;
  call_id: string;
  step: string;
  status: string;
  detail: string | null;
  duration_ms: number | null;
}

export interface EventRow {
  id: RowId;
  occurred_at: string;
  call_id: string;
  action: string;
  outcome: string;
  urgency: string | null;
  detail: Record<string, unknown> | null;
}

export interface MessageRow {
  id: RowId;
  created_at: string;
  call_id: string | null;
  to_number: string;
  to_label: string;
  body: string;
  status: string;
  provider: string;
}

export interface CallbackRow {
  id: RowId;
  created_at: string;
  call_id: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  town: string | null;
  reason: string;
  note: string | null;
  handled_at: string | null;
}

export interface CallRow {
  call_id: string;
  started_at: string;
  ended_at: string | null;
  channel: string;
  from_number: string | null;
  urgency: string | null;
  outcome: string | null;
  after_hours: boolean;
  booked: boolean;
  ticket_value: number | string | null;
  summary: string | null;
}

export interface Totals {
  calls_total: number;
  calls_after_hours: number;
  jobs_booked: number;
  revenue_booked: number;
  visits_by_agent: number;
  messages_total: number;
  callbacks_open: number;
}

export interface BoardTechnician {
  id: string;
  name: string;
  firstName: string;
  tone: TechnicianTone;
  onCall: boolean;
}

export interface BoardJobType {
  id: string;
  name: string;
  minutes: number;
  urgency: string;
}

export interface Board {
  dayOffset: number;
  date: string;
  startHour: number;
  endHour: number;
  technicians: BoardTechnician[];
  jobTypes: BoardJobType[];
  serviceArea: { zip: string; town: string }[];
}

export interface CompanyBadge {
  name: string;
  shortName: string;
  tagline: string;
  mainNumber: string;
}

export interface DemoMode {
  jobber: "mock" | "live";
  sms: "preview" | "twilio";
  afterHours: boolean;
  onCall: string;
  phoneNumber: string;
}

interface Cursors {
  pipeline: number;
  events: number;
  messages: number;
  callbacks: number;
}

interface StateResponse {
  company: CompanyBadge;
  mode: DemoMode;
  board: Board;
  visits: VisitRow[];
  pipeline: PipelineRow[];
  events: EventRow[];
  messages: MessageRow[];
  callbacks: CallbackRow[];
  calls: CallRow[];
  totals: Partial<Totals>;
  cursors: Cursors;
}

export interface DemoState {
  company: CompanyBadge | null;
  mode: DemoMode | null;
  board: Board | null;
  visits: VisitRow[];
  pipeline: PipelineRow[];
  events: EventRow[];
  messages: MessageRow[];
  /** Out of area callers the agent took a message from rather than booking. */
  callbacks: CallbackRow[];
  calls: CallRow[];
  totals: Totals;
  /** False once a poll has failed, true again on the next good response. */
  connected: boolean;
  /** True after the first successful poll, used to avoid a flash of empties. */
  loaded: boolean;
}

const EMPTY_TOTALS: Totals = {
  calls_total: 0,
  calls_after_hours: 0,
  jobs_booked: 0,
  revenue_booked: 0,
  visits_by_agent: 0,
  messages_total: 0,
  callbacks_open: 0,
};

const INITIAL: DemoState = {
  company: null,
  mode: null,
  board: null,
  visits: [],
  pipeline: [],
  events: [],
  messages: [],
  callbacks: [],
  calls: [],
  totals: EMPTY_TOTALS,
  connected: true,
  loaded: false,
};

function tail<T>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return existing;
  const next = existing.concat(incoming);
  return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next;
}

/** A count can arrive as a string over one driver and a number over the other. */
function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normaliseTotals(totals: Partial<Totals> | undefined): Totals {
  if (!totals) return EMPTY_TOTALS;
  return {
    calls_total: n(totals.calls_total),
    calls_after_hours: n(totals.calls_after_hours),
    jobs_booked: n(totals.jobs_booked),
    revenue_booked: n(totals.revenue_booked),
    visits_by_agent: n(totals.visits_by_agent),
    messages_total: n(totals.messages_total),
    callbacks_open: n(totals.callbacks_open),
  };
}

export interface UseDemoState {
  state: DemoState;
  /** Drops every appended row and rewinds the cursors, for the reset button. */
  clear: () => void;
}

export function useDemoState(dayOffset: number): UseDemoState {
  const [state, setState] = useState<DemoState>(INITIAL);

  const cursors = useRef<Cursors>({ pipeline: 0, events: 0, messages: 0, callbacks: 0 });
  const day = useRef(dayOffset);
  /** Bumped on clear so a request already in flight is discarded. */
  const generation = useRef(0);

  day.current = dayOffset;

  const clear = useCallback(() => {
    generation.current += 1;
    cursors.current = { pipeline: 0, events: 0, messages: 0, callbacks: 0 };
    setState((prev) => ({
      ...prev,
      visits: [],
      pipeline: [],
      events: [],
      messages: [],
      callbacks: [],
      calls: [],
      totals: EMPTY_TOTALS,
    }));
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      if (!alive) return;
      timer = setTimeout(run, ms);
    };

    async function run(): Promise<void> {
      if (!alive) return;

      // A hidden tab burns battery and browser timers throttle anyway. Wait for
      // the visibility listener below to wake the loop.
      if (typeof document !== "undefined" && document.hidden) {
        schedule(POLL_MS);
        return;
      }

      const mine = generation.current;
      const c = cursors.current;
      const url =
        `/api/state?pipeline=${c.pipeline}&events=${c.events}` +
        `&messages=${c.messages}&callbacks=${c.callbacks}&day=${day.current}`;

      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`state responded ${response.status}`);
        const data = (await response.json()) as StateResponse;

        if (!alive || generation.current !== mine) {
          schedule(POLL_MS);
          return;
        }

        cursors.current = data.cursors;

        setState((prev) => ({
          company: data.company,
          mode: data.mode,
          board: data.board,
          visits: data.visits,
          pipeline: tail(prev.pipeline, data.pipeline),
          events: tail(prev.events, data.events),
          messages: tail(prev.messages, data.messages),
          callbacks: tail(prev.callbacks, data.callbacks),
          calls: data.calls,
          totals: normaliseTotals(data.totals),
          connected: true,
          loaded: true,
        }));

        schedule(POLL_MS);
      } catch {
        // Silent by design. A hotel network drops packets and the demo should
        // simply catch up rather than show the client an error.
        if (alive && generation.current === mine) {
          setState((prev) => (prev.connected ? { ...prev, connected: false } : prev));
        }
        schedule(RETRY_MS);
      }
    }

    const wake = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        if (timer) clearTimeout(timer);
        schedule(0);
      }
    };

    document.addEventListener("visibilitychange", wake);
    void run();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  return { state, clear };
}
