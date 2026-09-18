"use client";

/**
 * The left column: place the call, watch who is speaking, read the words.
 *
 * The urgency badge is the piece that wins the room. The moment triage fires
 * the caller stops being a voice and becomes a category the shop already has
 * a rule for, and the badge says which one in a colour the owner can read
 * from the back of the office.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { URGENCY_LABEL, type Urgency } from "@/lib/config";
import type { CallPhase, TranscriptTurn } from "@/app/hooks/useRetellCall";

export interface CallPanelProps {
  phase: CallPhase;
  isLive: boolean;
  configured: boolean;
  callId: string | null;
  startedAt: number | null;
  agentTalking: boolean;
  ringing: boolean;
  muted: boolean;
  turns: TranscriptTurn[];
  /** Set the instant triage answers, from the tool result or the poll. */
  urgency: Urgency | null;
  urgencyDetail: string | null;
  phoneNumber: string;
  companyName: string;
  error: string | null;
  endedReason: string | null;
  onStart: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
}

const PHASE_LABEL: Record<CallPhase, string> = {
  idle: "Ready",
  connecting: "Connecting",
  live: "Connected",
  ending: "Hanging up",
  ended: "Call ended",
  error: "Not connected",
};

const URGENCY_LINE: Record<Urgency, string> = {
  emergency: "Dispatch tonight, the on call technician is paged",
  urgent: "First available window, ahead of routine work",
  routine: "Booked into the ordinary schedule",
  quote: "Passed to the team who price replacements",
};

const BAR_COUNT = 7;

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function CallPanel(props: CallPanelProps) {
  const {
    phase,
    isLive,
    configured,
    callId,
    startedAt,
    agentTalking,
  ringing,
    muted,
    turns,
    urgency,
    urgencyDetail,
    phoneNumber,
    companyName,
    error,
    endedReason,
    onStart,
    onEnd,
    onToggleMute,
  } = props;

  const scroller = useRef<HTMLDivElement | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt || phase === "idle") return;
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    if (phase !== "live" && phase !== "connecting") return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, phase]);

  // Follow the conversation, but leave the presenter alone if they scrolled up.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distance < 140) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, [turns.length, turns[turns.length - 1]?.content]);

  const lastIndex = turns.length - 1;

  const voiceState = useMemo(() => {
    if (!isLive) {
      return { className: "voice", label: "Microphone off", hint: "Start a call to hear the line." };
    }
    if (phase === "connecting") {
      return { className: "voice", label: "Connecting", hint: "Setting up the audio channel." };
    }
    if (ringing && !agentTalking) {
      return { className: "voice is-ringing", label: "Ringing", hint: "Picking up in a moment." };
    }
    if (agentTalking) {
      return {
        className: "voice is-agent",
        label: "Agent speaking",
        hint: "Cut in whenever you like, it stops and listens.",
      };
    }
    return {
      className: "voice is-listening",
      label: muted ? "Microphone muted" : "Listening",
      hint: muted ? "The agent cannot hear you." : "Go ahead, speak normally.",
    };
  }, [isLive, phase, agentTalking, ringing, muted]);

  return (
    <section className="panel" aria-label="Call the service line">
      <div className="panel-head">
        <h2 className="panel-title">Service line</h2>
        <p className="panel-sub">{companyName}</p>
        <div className="panel-head-end">
          <span className={`tag${isLive ? " tag-accent" : ""}`}>{PHASE_LABEL[phase]}</span>
        </div>
      </div>

      <div className="panel-body">
        <div className="call-top">
          <button
            type="button"
            className={`btn btn-cta${isLive ? " is-live" : ""}`}
            onClick={isLive ? onEnd : onStart}
            disabled={!configured || phase === "connecting" || phase === "ending"}
          >
            {isLive ? "End call" : "Call the service line"}
          </button>

          {!configured ? (
            <p className="setup-note">
              Voice is not wired up on this deployment. Set{" "}
              <code>NEXT_PUBLIC_RETELL_PUBLIC_KEY</code> and{" "}
              <code>NEXT_PUBLIC_RETELL_AGENT_ID</code>, then reload. Everything else on this
              screen is live.
            </p>
          ) : null}

          {phoneNumber ? (
            <p className="phone-hint">
              or call <span className="phone-number">{phoneNumber}</span>
            </p>
          ) : null}

          {error ? (
            <p className="call-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className={voiceState.className}>
            <div className="voice-bars" aria-hidden="true">
              {Array.from({ length: BAR_COUNT }, (_, i) => (
                <span className="voice-bar" key={i} />
              ))}
            </div>
            <div className="voice-text">
              <div className="voice-label">{voiceState.label}</div>
              <div className="voice-hint">{voiceState.hint}</div>
            </div>
          </div>

          <div aria-live="polite">
            {urgency ? (
              <div className={`urgency u-${urgency}`} key={urgency}>
                <span className="urgency-word">{URGENCY_LABEL[urgency]}</span>
                <span className="urgency-body">
                  <span className="urgency-kicker">Triaged</span>
                  <span className="urgency-detail">
                    {urgencyDetail ?? URGENCY_LINE[urgency]}
                  </span>
                </span>
              </div>
            ) : null}
          </div>

          <div className="call-status">
            <span className="call-id">
              {callId ? `call ${callId.slice(0, 18)}` : `agent for ${companyName}`}
            </span>
            {isLive || phase === "ended" ? <span className="mono num">{clock(elapsed)}</span> : null}
            {isLive ? (
              <button type="button" className="btn btn-quiet" onClick={onToggleMute}>
                {muted ? "Unmute" : "Mute"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="transcript-head">
          <span className="transcript-head-title">Live transcript</span>
          <span className="tag num">{turns.length} turns</span>
        </div>

        <div
          className="transcript scroll"
          ref={scroller}
          aria-live="polite"
          aria-atomic="false"
          aria-label="Call transcript"
        >
          {turns.length === 0 ? (
            <div className="empty">
              {phase === "ended" ? (
                <>
                  <strong>That call is done.</strong> The board, the pipeline and the texts on
                  this screen are exactly what it left behind. Start another whenever you are
                  ready.
                </>
              ) : (
                <>
                  <strong>Nothing said yet.</strong> Press call, allow the microphone, and speak
                  the way a customer would. A good opening is: my furnace is dead and the house
                  is freezing, I am at 812 North Dunton in Arlington Heights.
                  <br />
                  <br />
                  Every word appears here as it is spoken.
                </>
              )}
            </div>
          ) : (
            turns.map((turn, index) => {
              const growing = index === lastIndex && phase === "live";
              return (
                <article
                  key={turn.id}
                  className={`turn turn-${turn.role}${
                    growing && agentTalking && turn.role === "agent" ? " is-growing" : ""
                  }`}
                >
                  <div className="turn-role">{turn.role === "agent" ? "Agent" : "Caller"}</div>
                  <div className="turn-text">{turn.content}</div>
                </article>
              );
            })
          )}
        </div>

        {endedReason ? (
          <div className="panel-foot mono">Ended: {endedReason.replace(/_/g, " ")}</div>
        ) : null}
      </div>
    </section>
  );
}
