"use client";

/**
 * The fixed ladder every call climbs, in the order lib/ops.ts defines.
 *
 * Two sources feed it. The server poll is the truth and carries the real
 * status and timing. The agent's own tool call invocations arrive in the
 * browser a moment earlier, so a rung lights as running the instant the agent
 * reaches for a tool, then the poll settles it green, amber or red.
 */

import { useMemo } from "react";
import type { PipelineRow } from "@/app/hooks/useDemoState";
import type { ToolSignal } from "@/app/hooks/useRetellCall";

/**
 * Mirrors PIPELINE_STEPS in lib/ops.ts, which is the contract. It is repeated
 * rather than imported because lib/ops.ts reaches for the database driver, and
 * neither pg nor PGlite belongs in a browser bundle.
 */
const PIPELINE_STEPS = [
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

export interface PipelinePanelProps {
  events: PipelineRow[];
  /** The call the ladder is showing. Changing it resets the ladder. */
  focusCallId: string | null;
  toolSignals: ToolSignal[];
  live: boolean;
}

type Step = (typeof PIPELINE_STEPS)[number];
type StepState = "idle" | "running" | "ok" | "warn" | "error";

const STEP_COPY: Record<Step, { name: string; hint: string }> = {
  call_answered: {
    name: "Call answered",
    hint: "First ring, day or night",
  },
  intent_classified: {
    name: "Reason understood",
    hint: "Service call, estimate, or office",
  },
  urgency_triaged: {
    name: "Urgency triaged",
    hint: "Your rules, not a generic script",
  },
  service_area_checked: {
    name: "Service area checked",
    hint: "Postcode against the towns you cover",
  },
  caller_qualified: {
    name: "Caller qualified",
    hint: "What a dispatcher asks first",
  },
  client_matched: {
    name: "Customer matched",
    hint: "Known number reused, not duplicated",
  },
  job_created: {
    name: "Job created",
    hint: "On the schedule, with a window",
  },
  technician_notified: {
    name: "Technician notified",
    hint: "Only when it cannot wait",
  },
  caller_confirmed: {
    name: "Caller confirmed",
    hint: "Confirmation text to the customer",
  },
};

/** Which rung a tool call lights the moment the agent reaches for it. */
const TOOL_STEP: Record<string, Step> = {
  triage_problem: "urgency_triaged",
  check_service_area: "service_area_checked",
  find_or_create_customer: "client_matched",
  get_arrival_windows: "caller_qualified",
  book_visit: "job_created",
  notify_on_call: "technician_notified",
  log_estimate_request: "job_created",
};

interface Rung {
  step: Step;
  state: StepState;
  detail: string | null;
  durationMs: number | null;
}

function toState(status: string): StepState {
  if (status === "ok" || status === "warn" || status === "error" || status === "running") {
    return status;
  }
  return "idle";
}

export default function PipelinePanel({
  events,
  focusCallId,
  toolSignals,
  live,
}: PipelinePanelProps) {
  const { rungs, done } = useMemo(() => {
    const latest = new Map<Step, Rung>();

    // With no call in focus the ladder stays idle. Merging every seeded call
    // into one ladder would show the client a trace that never happened.
    for (const event of focusCallId ? events : []) {
      if (event.call_id !== focusCallId) continue;
      const step = event.step as Step;
      if (!(PIPELINE_STEPS as readonly string[]).includes(step)) continue;
      latest.set(step, {
        step,
        state: toState(event.status),
        detail: event.detail,
        durationMs: event.duration_ms,
      });
    }

    // The browser sees the tool call before the server writes its row.
    if (focusCallId) {
      if (!latest.has("call_answered")) {
        latest.set("call_answered", {
          step: "call_answered",
          state: "ok",
          detail: "picked up on the first ring",
          durationMs: null,
        });
      }
      for (const signal of toolSignals) {
        const step = TOOL_STEP[signal.name];
        if (!step) continue;
        if (!latest.has("intent_classified")) {
          latest.set("intent_classified", {
            step: "intent_classified",
            state: "ok",
            detail: "service call",
            durationMs: null,
          });
        }
        if (!latest.has(step)) {
          latest.set(step, {
            step,
            state: "running",
            detail: signal.name.replace(/_/g, " "),
            durationMs: null,
          });
        }
      }
    }

    const list: Rung[] = PIPELINE_STEPS.map(
      (step) => latest.get(step) ?? { step, state: "idle" as StepState, detail: null, durationMs: null },
    );

    return { rungs: list, done: list.filter((r) => r.state === "ok").length };
  }, [events, focusCallId, toolSignals]);

  return (
    <section className="panel" aria-label="Call pipeline">
      <div className="panel-head">
        <h2 className="panel-title">Pipeline</h2>
        <p className="panel-sub">The same nine steps on every call</p>
        <div className="panel-head-end">
          <span className={`tag${live ? " tag-accent" : ""} num`}>
            {done} of {PIPELINE_STEPS.length}
          </span>
        </div>
      </div>

      <div className="panel-body scroll">
        <ol className="ladder" aria-live="polite" aria-label="Pipeline steps">
          {rungs.map((rung) => {
            const copy = STEP_COPY[rung.step];
            return (
              <li
                key={rung.step}
                className={`step${rung.state === "idle" ? "" : ` is-${rung.state}`}`}
              >
                <span className="step-dot" aria-hidden="true" />
                <span>
                  <span className="step-name">{copy.name}</span>
                  <span className="step-detail">
                    {rung.state === "idle" ? copy.hint : (rung.detail ?? copy.hint)}
                  </span>
                  <span className="sr-only">
                    {rung.state === "idle" ? "not started" : rung.state}
                  </span>
                </span>
                <span className="step-dur num">
                  {rung.durationMs !== null ? `${rung.durationMs} ms` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {!focusCallId ? (
        <div className="panel-foot">Idle. It fills from the top on the next call.</div>
      ) : null}
    </section>
  );
}
