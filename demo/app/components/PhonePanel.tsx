"use client";

/**
 * The texts, on a phone.
 *
 * Twilio is not connected yet, so every message is composed and stored with
 * status queued rather than sent. Showing them on a handset is how the SMS
 * part of the demo lands before the number exists: the owner reads the exact
 * words their customer and their on call technician will get, and the note
 * underneath is honest about what has and has not been sent.
 */

import { useEffect, useRef } from "react";
import type { MessageRow } from "@/app/hooks/useDemoState";

export interface PhonePanelProps {
  messages: MessageRow[];
  smsMode: "preview" | "twilio";
}

const TIME_FMT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function statusClass(status: string): string {
  if (status === "sent") return "status-pill status-sent";
  if (status === "failed") return "status-pill status-failed";
  return "status-pill status-queued";
}

function label(to: string): string {
  return to === "technician" ? "To technician" : "To caller";
}

export default function PhonePanel({ messages, smsMode }: PhonePanelProps) {
  const screen = useRef<HTMLDivElement | null>(null);

  // Bring the newest message to the top of the little screen rather than the
  // bottom. On a short panel that is the difference between reading the text
  // and reading the timestamp underneath it.
  useEffect(() => {
    const node = screen.current;
    if (!node) return;
    const last = node.lastElementChild as HTMLElement | null;
    const top = last ? Math.max(0, last.offsetTop - node.offsetTop - 4) : node.scrollHeight;
    node.scrollTo({ top: Math.min(top, node.scrollHeight), behavior: "smooth" });
  }, [messages.length]);

  const preview = smsMode === "preview";

  return (
    <section className="panel" aria-label="Outbound texts">
      <div className="panel-head">
        <h2 className="panel-title">Texts</h2>
        <p className="panel-sub">{preview ? "Composed, not sent" : "Sending through Twilio"}</p>
        <div className="panel-head-end">
          <span className={`tag${messages.length > 0 ? " tag-accent" : ""} num`}>
            {messages.length}
          </span>
        </div>
      </div>

      <div className="panel-body">
        <div className="phone-wrap">
          <div className="phone-shell">
            <div className="phone-notch" aria-hidden="true" />
            <div
              className="phone-screen scroll"
              ref={screen}
              aria-live="polite"
              aria-label="Outbound text messages"
            >
              {messages.length === 0 ? (
                <p className="phone-empty">
                  <strong>No texts yet.</strong>
                  The confirmation to the customer and the page to the on call technician both
                  land here, worded exactly as they will go out.
                </p>
              ) : (
                messages.map((m) => (
                  <div
                    key={String(m.id)}
                    className={`bubble ${m.to_label === "technician" ? "bubble-tech" : "bubble-caller"}`}
                  >
                    <div className="bubble-head">
                      <span>{label(m.to_label)}</span>
                      <span className={statusClass(m.status)}>{m.status}</span>
                    </div>
                    <div className="bubble-body">{m.body}</div>
                    <div className="bubble-num">
                      {m.to_number} {"·"} {TIME_FMT.format(new Date(m.created_at))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <p className="sms-note">
          {preview ? (
            <>
              <strong>Preview mode.</strong> These texts are written and stored, and nothing
              leaves the building. Connect a Twilio number and the same messages send for real.
            </>
          ) : (
            <>
              <strong>Twilio is connected.</strong> These messages go out to real handsets, and
              each pill shows what the carrier came back with.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
