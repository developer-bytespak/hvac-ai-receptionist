"use client";

/**
 * The demo screen. One full height page, five regions, no page scrolling.
 *
 * Left is the call, centre is the day it writes into, right is the pipeline,
 * the money and the texts. Everything is fed by a single poll of /api/state,
 * so the whole screen agrees with itself at every moment.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import CallPanel from "@/app/components/CallPanel";
import DispatchBoard from "@/app/components/DispatchBoard";
import PipelinePanel from "@/app/components/PipelinePanel";
import RevenuePanel from "@/app/components/RevenuePanel";
import PhonePanel from "@/app/components/PhonePanel";
import {
  COMPANY,
  URGENCY_LABEL,
  isAfterHours,
  onCallTechnician,
  type Urgency,
} from "@/lib/config";
import { useDemoState } from "@/app/hooks/useDemoState";
import { useRetellCall } from "@/app/hooks/useRetellCall";

const DAYS = [
  { offset: 0, label: "Today" },
  { offset: 1, label: "Tomorrow" },
  { offset: 2, label: "In two days" },
];

type Theme = "system" | "light" | "dark";

/** "Emergency, no heat" comes back from the pipeline. Recover the key from it. */
const LABEL_TO_URGENCY = new Map<string, Urgency>(
  (Object.keys(URGENCY_LABEL) as Urgency[]).map((key) => [URGENCY_LABEL[key].toLowerCase(), key]),
);

function urgencyFromDetail(detail: string | null): Urgency | null {
  if (!detail) return null;
  const head = detail.split(",")[0]?.trim().toLowerCase() ?? "";
  return LABEL_TO_URGENCY.get(head) ?? null;
}

/** The badge already shouts the word, so the line under it carries the reason. */
function reasonFromDetail(detail: string | null): string | null {
  if (!detail) return null;
  const comma = detail.indexOf(",");
  if (comma === -1) return detail;
  const rest = detail.slice(comma + 1).trim();
  return rest.length > 0 ? rest : detail;
}

function isUrgency(value: unknown): value is Urgency {
  return value === "emergency" || value === "urgent" || value === "routine" || value === "quote";
}

export default function Page() {
  const [dayOffset, setDayOffset] = useState(0);
  const [theme, setTheme] = useState<Theme>("system");
  const [resetting, setResetting] = useState(false);

  /**
   * What the screen actually looks like right now. With no explicit choice
   * the operating system decides, so the toggle has to ask it rather than
   * guess, or the button offers the theme you are already looking at.
   */
  const [systemLight, setSystemLight] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => setSystemLight(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const showingLight = theme === "light" || (theme === "system" && systemLight);

  const { state, clear } = useDemoState(dayOffset);
  const call = useRetellCall();

  /** The calls that already existed when this screen opened. */
  const [baseline, setBaseline] = useState<Set<string> | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  // Take the baseline once, on the first poll that lands. Anything after it is
  // a call the client is actually watching.
  useEffect(() => {
    if (!state.loaded || baseline) return;
    setBaseline(new Set(state.calls.map((c) => c.call_id)));
  }, [state.loaded, state.calls, baseline]);

  const companyName = state.company?.name ?? call.config?.company.name ?? COMPANY.name;
  const shortName = state.company?.shortName ?? call.config?.company.shortName ?? COMPANY.shortName;
  const tagline = state.company?.tagline ?? call.config?.company.tagline ?? COMPANY.tagline;
  const currency = call.config?.company.currency ?? COMPANY.currency;

  const jobberMode = state.mode?.jobber ?? call.config?.integrations.jobber.mode ?? "mock";
  const smsMode = state.mode?.sms ?? call.config?.integrations.sms.mode ?? "preview";
  const phoneNumber = state.mode?.phoneNumber || call.config?.retell.phoneNumber || "";
  const configured = call.config?.retell.configured ?? false;

  // The header is honest before the first poll lands by asking the same rules
  // the server asks, so the screen is never a blank shell.
  const afterHours = state.mode?.afterHours ?? isAfterHours();
  const onCall = state.mode?.onCall ?? onCallTechnician().firstName;

  /**
   * The ladder and the badge follow the call in front of the client, which is
   * the web call if there is one, otherwise a call that arrived on the real
   * number while this screen has been open. The seeded calls the demo ships
   * with are older than the page, so the ladder starts idle rather than
   * replaying somebody else's Tuesday.
   */
  const latestCall = state.calls[0] ?? null;
  const focusCallId = useMemo(() => {
    if (call.callId) return call.callId;
    if (!latestCall || !baseline) return null;
    return baseline.has(latestCall.call_id) ? null : latestCall.call_id;
  }, [call.callId, latestCall, baseline]);

  /**
   * The urgency badge. The pipeline row is the truth, and the agent's own tool
   * result stands in for it during the second or so before the poll catches up.
   */
  const triage = useMemo<{ urgency: Urgency; detail: string | null } | null>(() => {
    if (!focusCallId) return null;

    for (let i = state.pipeline.length - 1; i >= 0; i--) {
      const row = state.pipeline[i];
      if (row.call_id !== focusCallId || row.step !== "urgency_triaged") continue;
      const key = urgencyFromDetail(row.detail);
      if (key) return { urgency: key, detail: reasonFromDetail(row.detail) };
    }

    for (let i = call.toolSignals.length - 1; i >= 0; i--) {
      const signal = call.toolSignals[i];
      if (signal.name !== "triage_problem" || !signal.result) continue;
      try {
        const parsed: unknown = JSON.parse(signal.result);
        const body = parsed as { urgency?: unknown; reason?: unknown };
        if (!isUrgency(body.urgency)) continue;
        const reason = typeof body.reason === "string" ? body.reason : null;
        return { urgency: body.urgency, detail: reason };
      } catch {
        /* A partial result is not worth a broken badge. */
      }
    }

    if (latestCall && latestCall.call_id === focusCallId && isUrgency(latestCall.urgency)) {
      return { urgency: latestCall.urgency, detail: null };
    }

    return null;
  }, [focusCallId, state.pipeline, call.toolSignals, latestCall]);

  const onReset = useCallback(async () => {
    setResetting(true);
    try {
      await fetch("/api/reset", { method: "POST" });
    } catch {
      /* The connection tag reports it on the next poll. */
    }
    clear();
    setBaseline(null);
    setDayOffset(0);
    setResetting(false);
  }, [clear]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            {shortName.slice(0, 1).toUpperCase()}
          </span>
          <div className="brand-text">
            <h1 className="brand-name">{companyName}</h1>
            <p className="brand-tagline">{tagline}</p>
          </div>
        </div>

        <span className={`hours-flag${afterHours ? " is-after" : ""}`} role="status">
          <span className="flag-dot" aria-hidden="true" />
          {afterHours ? (
            <>
              After hours, <span className="flag-who">{onCall}</span> is on call
            </>
          ) : (
            <>Office open</>
          )}
        </span>

        <div className="header-modes">
          <span className={`chip${jobberMode === "live" ? " is-live" : ""}`}>
            Jobber: {jobberMode}
          </span>
          <span className={`chip${smsMode === "twilio" ? " is-live" : ""}`}>
            SMS: {smsMode === "twilio" ? "Twilio" : "preview"}
          </span>
        </div>

        {!state.connected ? (
          <span className="tag tag-warn" role="status">
            Reconnecting
          </span>
        ) : null}

        <div className="header-spacer" />

        <div className="header-controls">
          <div className="field">
            <span className="field-label" id="day-label">
              Day
            </span>
            <div className="seg" role="group" aria-labelledby="day-label">
              {DAYS.map((d) => (
                <button
                  key={d.offset}
                  type="button"
                  className="seg-btn"
                  aria-pressed={dayOffset === d.offset}
                  onClick={() => setDayOffset(d.offset)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setTheme(showingLight ? "dark" : "light")}
          >
            {showingLight ? "Dark" : "Light"}
          </button>

          <button type="button" className="btn" onClick={onReset} disabled={resetting}>
            {resetting ? "Resetting" : "Reset demo"}
          </button>
        </div>
      </header>

      <main className="main">
        <div className="col">
          <CallPanel
            phase={call.phase}
            isLive={call.isLive}
            configured={configured}
            callId={call.callId}
            startedAt={call.startedAt}
            agentTalking={call.agentTalking}
            muted={call.muted}
            turns={call.turns}
            urgency={triage?.urgency ?? null}
            urgencyDetail={triage?.detail ?? null}
            phoneNumber={phoneNumber}
            companyName={companyName}
            error={call.error}
            endedReason={call.endedReason}
            onStart={() => {
              void call.start();
            }}
            onEnd={() => {
              void call.end();
            }}
            onToggleMute={call.toggleMute}
          />
        </div>

        <div className="col">
          <DispatchBoard
            board={state.board}
            visits={state.visits}
            dayOffset={dayOffset}
            loaded={state.loaded}
          />
        </div>

        <div className="col col-right">
          <PipelinePanel
            events={state.pipeline}
            focusCallId={focusCallId}
            toolSignals={call.toolSignals}
            live={call.isLive}
          />
          <RevenuePanel totals={state.totals} currency={currency} />
          <PhonePanel messages={state.messages} smsMode={smsMode} />
        </div>
      </main>
    </div>
  );
}
