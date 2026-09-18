"use client";

/**
 * The web call itself, wrapped so the panels only ever see plain data.
 *
 * Two things here matter for the demo. The transcript is requested from the
 * SDK so the client sees the words as they are spoken, and the tool call
 * invocations are surfaced separately so the pipeline ladder can light up the
 * instant the agent reaches for the schedule, a beat before the server poll
 * confirms it.
 *
 * The SDK is imported lazily inside start() because it is a browser transport
 * and has no business running during server rendering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startRingback, type Ringback } from "./ringback";
import type {
  CallEndedEvent,
  LiveCallUtterance,
  SessionStatus,
  WebCallSession,
} from "retell-client-js-sdk";

export type CallPhase = "idle" | "connecting" | "live" | "ending" | "ended" | "error";

export interface TranscriptTurn {
  id: string;
  role: "agent" | "user";
  content: string;
  timeSec: number;
}

/** A tool the agent reached for, used to light the pipeline without waiting. */
export interface ToolSignal {
  toolCallId: string;
  name: string;
  /** Undefined until the result comes back. */
  successful?: boolean;
  /** The raw result body, which is how triage reaches the urgency badge early. */
  result?: string;
}

export interface DemoConfig {
  company: {
    name: string;
    shortName: string;
    tagline: string;
    mainNumber: string;
    timezone: string;
    currency: string;
  };
  technicians: { id: string; firstName: string; name: string; tone: string }[];
  serviceArea: { zip: string; town: string }[];
  retell: {
    publicKey: string;
    agentId: string;
    phoneNumber: string;
    configured: boolean;
  };
  integrations: {
    jobber: { mode: "mock" | "live"; credentialsPresent: boolean };
    sms: { mode: "preview" | "twilio"; credentialsPresent: boolean };
  };
}

export interface UseRetellCall {
  config: DemoConfig | null;
  phase: CallPhase;
  isLive: boolean;
  callId: string | null;
  startedAt: number | null;
  agentTalking: boolean;
  ringing: boolean;
  muted: boolean;
  turns: TranscriptTurn[];
  toolSignals: ToolSignal[];
  currentNode: string | null;
  endedReason: string | null;
  error: string | null;
  start: () => Promise<void>;
  end: () => Promise<void>;
  toggleMute: () => void;
}

function isSpeech(
  u: LiveCallUtterance,
): u is LiveCallUtterance & { role: "agent" | "user"; content: string } {
  return u.role === "agent" || u.role === "user";
}

export function useRetellCall(): UseRetellCall {
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [agentTalking, setAgentTalking] = useState(false);
  /** True from the call button until the agent first speaks. */
  const [ringing, setRinging] = useState(false);
  const ringRef = useRef<Ringback | null>(null);
  const stopRinging = useCallback(() => {
    ringRef.current?.stop();
    ringRef.current = null;
    setRinging(false);
  }, []);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [toolSignals, setToolSignals] = useState<ToolSignal[]>([]);
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<WebCallSession | null>(null);
  const startingRef = useRef(false);
  const configRef = useRef<DemoConfig | null>(null);
  configRef.current = config;

  // Public demo configuration. The Retell public key is meant to be visible.
  useEffect(() => {
    let alive = true;
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<DemoConfig>) : null))
      .then((data) => {
        if (alive && data) setConfig(data);
      })
      .catch(() => {
        /* The screen is still useful without it, the call button explains. */
      });
    return () => {
      alive = false;
    };
  }, []);

  const applyTranscript = useCallback((transcript: LiveCallUtterance[]) => {
    const speech: TranscriptTurn[] = [];
    const tools = new Map<string, ToolSignal>();

    for (const u of transcript) {
      if (isSpeech(u)) {
        if (!u.content) continue;
        speech.push({ id: u.id, role: u.role, content: u.content, timeSec: u.time_sec });
      } else if (u.role === "tool_call_invocation") {
        const existing = tools.get(u.tool_call_id);
        tools.set(u.tool_call_id, {
          toolCallId: u.tool_call_id,
          name: u.name,
          successful: existing?.successful,
          result: existing?.result,
        });
      } else if (u.role === "tool_call_result") {
        const existing = tools.get(u.tool_call_id);
        tools.set(u.tool_call_id, {
          toolCallId: u.tool_call_id,
          name: existing?.name ?? "",
          successful: u.successful,
          result: u.content,
        });
      }
    }

    setTurns(speech);
    setToolSignals([...tools.values()]);
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || sessionRef.current) return;

    const current = configRef.current;
    const publicKey = current?.retell.publicKey ?? "";
    const agentId = current?.retell.agentId ?? "";
    if (!publicKey || !agentId) {
      setError("The Retell public key and agent id are not set on this deployment.");
      setPhase("error");
      return;
    }

    startingRef.current = true;
    setError(null);
    setEndedReason(null);
    setCurrentNode(null);
    setTurns([]);
    setToolSignals([]);
    setCallId(null);
    setMuted(false);
    setPhase("connecting");
    ringRef.current?.stop();
    ringRef.current = startRingback();
    setRinging(true);

    try {
      const { RetellClient } = await import("retell-client-js-sdk");
      const client = new RetellClient({ key: publicKey });

      const session = client.createWebCall({
        agent_id: agentId,
        transcript: true,
        retell_llm_dynamic_variables: {
          company_name: current?.company.name ?? "",
          short_name: current?.company.shortName ?? "",
          callback_number: current?.company.mainNumber ?? "",
        },
        metadata: { source: "demo" },
        hooks: {
          onStatus: (status: SessionStatus) => {
            if (status === "connecting") setPhase("connecting");
            else if (status === "live") setPhase("live");
            else if (status === "ended") setPhase("ended");
          },
          onTranscript: (transcript: LiveCallUtterance[]) => {
            // The agent-start-talking event does not arrive on every transport,
            // so the first agent line in the transcript also ends the ring.
            if (transcript.some((u) => u.role === "agent" && "content" in u && u.content)) stopRinging();
            applyTranscript(transcript);
          },
          onAgentStartTalking: () => {
            stopRinging();
            setAgentTalking(true);
          },
          onAgentStopTalking: () => setAgentTalking(false),
          onNodeTransition: (event) => {
            const name = (event as { new_node_name?: unknown }).new_node_name;
            if (typeof name === "string") setCurrentNode(name);
          },
          onEnd: (event: CallEndedEvent) => {
            stopRinging();
            setEndedReason(event.disconnection_reason ?? null);
            setAgentTalking(false);
            setPhase("ended");
            sessionRef.current = null;
          },
          onError: (err: Error) => {
            stopRinging();
            setError(err.message || "The call could not be connected.");
            setAgentTalking(false);
            setPhase("error");
            sessionRef.current = null;
          },
        },
      });

      sessionRef.current = session;
      setStartedAt(Date.now());

      await session.ready;
      setCallId(session.callId ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The call could not be connected.";
      setError(
        /permission|denied|notallowed/i.test(message)
          ? "Microphone access was blocked. Allow the microphone for this site and try again."
          : message,
      );
      setPhase("error");
      sessionRef.current = null;
      stopRinging();
    } finally {
      startingRef.current = false;
    }
  }, [applyTranscript, stopRinging]);

  const end = useCallback(async () => {
    stopRinging();
    const session = sessionRef.current;
    if (!session) {
      setPhase((prev) => (prev === "idle" ? prev : "ended"));
      return;
    }
    setPhase("ending");
    try {
      await session.end();
    } catch {
      /* Already gone, the end hook has told us everything we need. */
    }
    sessionRef.current = null;
    setAgentTalking(false);
    setPhase("ended");
  }, [stopRinging]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setMuted((prev) => {
      if (prev) session.unmute();
      else session.mute();
      return !prev;
    });
  }, []);

  // Never leave a live microphone behind on a hot reload or a route change.
  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void session.end().catch(() => undefined);
    };
  }, []);

  const isLive = phase === "live" || phase === "connecting" || phase === "ending";

  return useMemo(
    () => ({
      config,
      phase,
      isLive,
      callId,
      startedAt,
      agentTalking,
      ringing,
      muted,
      turns,
      toolSignals,
      currentNode,
      endedReason,
      error,
      start,
      end,
      toggleMute,
    }),
    [
      config,
      phase,
      isLive,
      callId,
      startedAt,
      agentTalking,
      ringing,
      muted,
      turns,
      toolSignals,
      currentNode,
      endedReason,
      error,
      start,
      end,
      toggleMute,
    ],
  );
}
