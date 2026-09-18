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
import DayPicker from "@/app/components/DayPicker";
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

/**
 * The sidebar. Only the first item is a real screen. The others put a
 * spotlight on one region of it, which is what a presenter actually wants
 * mid demo: "let's look at the money" and the rest steps back.
 */
type View = "desk" | "call" | "board" | "money";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "desk", label: "Dispatch desk", icon: "M4 6h16M4 12h16M4 18h10" },
  { id: "call", label: "Front desk", icon: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" },
  { id: "board", label: "Dispatch board", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { id: "money", label: "Pipeline and money", icon: "M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.5 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3" },
];

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

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
  const [view, setView] = useState<View>("desk");

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
    <div className="app" data-view={view}>
      <aside className="sidebar" aria-label="Sections">
        <div className="side-brand">
          <span className="brand-mark" aria-hidden="true">
            {shortName.slice(0, 1).toUpperCase()}
          </span>
          <div className="brand-text">
            <span className="brand-name">{companyName}</span>
            <span className="brand-tagline">AI dispatcher</span>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className="nav-item"
              title={item.label}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d={item.icon} />
              </svg>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="side-foot">
          <span className={`hours-flag${afterHours ? " is-after" : ""}`} role="status">
            <span className="flag-dot" aria-hidden="true" />
            <span className="flag-text">
              {afterHours ? (
                <>
                  After hours, <span className="flag-who">{onCall}</span> on call
                </>
              ) : (
                <>Office open</>
              )}
            </span>
          </span>

          <div className="side-modes">
            <span className={`chip${jobberMode === "live" ? " is-live" : ""}`}>
              <span className="chip-text">Jobber: {jobberMode}</span>
            </span>
            <span className={`chip${smsMode === "twilio" ? " is-live" : ""}`}>
              <span className="chip-text">SMS: {smsMode === "twilio" ? "Twilio" : "preview"}</span>
            </span>
          </div>

          <button type="button" className="side-reset" onClick={onReset} disabled={resetting} title="Reset demo">
            <svg className="side-reset-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
            </svg>
            <span className="side-reset-label">{resetting ? "Resetting" : "Reset demo"}</span>
            <span className="side-reset-hint">Clears the board and the ledger</span>
          </button>
        </div>
      </aside>

      <div className="stage">
        <header className="topbar">
          <div className="greet">
            <h1 className="greet-title">
              {greetingForHour(new Date().getHours())}, {shortName}
            </h1>
            <p className="greet-sub">{tagline}</p>
          </div>

          {!state.connected ? (
            <span className="tag tag-warn" role="status">
              Reconnecting
            </span>
          ) : null}

          <div className="header-spacer" />

          <div className="header-controls">
            <div className="field">
              <span className="field-label">Day</span>
              <DayPicker dayOffset={dayOffset} onChange={setDayOffset} />
            </div>

            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setTheme(showingLight ? "dark" : "light")}
            >
              {showingLight ? "Dark" : "Light"}
            </button>

            <div className="avatar" aria-label={`On call, ${onCall}`}>
              <span className="avatar-mark" aria-hidden="true">
                {onCall
                  .split(" ")
                  .slice(0, 2)
                  .map((w) => w[0] ?? "")
                  .join("")
                  .toUpperCase()}
              </span>
              <span className="avatar-text">
                <span className="avatar-name">{onCall}</span>
                <span className="avatar-sub">{afterHours ? "On call tonight" : "Next on call"}</span>
              </span>
            </div>
          </div>
        </header>

      <main className="main">
        <div className="col col-call">
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

        <div className="col col-board">
          <DispatchBoard
            board={state.board}
            visits={state.visits}
            dayOffset={dayOffset}
            loaded={state.loaded}
          />
        </div>

        <div className="col col-right col-money">
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
    </div>
  );
}
