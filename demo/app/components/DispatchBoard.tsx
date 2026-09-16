"use client";

/**
 * The centre column: one working day, one column per technician.
 *
 * Visits are positioned as a percentage of the working day rather than in
 * pixels, so the board stays correct on a laptop, a meeting room screen and a
 * projector without recalculating anything in JavaScript.
 *
 * The left edge of every visit carries its urgency colour, and anything the
 * agent booked while the owner was watching slides in once and then keeps its
 * cobalt outline for the rest of the demo.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { DAY_END_HOUR, DAY_START_HOUR, SLOT_MINUTES, URGENCY_LABEL, type Urgency } from "@/lib/config";
import type { Board, TechnicianTone, VisitRow } from "@/app/hooks/useDemoState";

export interface DispatchBoardProps {
  board: Board | null;
  visits: VisitRow[];
  dayOffset: number;
  loaded: boolean;
}

const TIME_FMT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
});

const TONE_VARS: Record<TechnicianTone, { tone: string; fill: string }> = {
  blue: { tone: "var(--tone-blue)", fill: "var(--tone-blue-fill)" },
  rust: { tone: "var(--tone-rust)", fill: "var(--tone-rust-fill)" },
  moss: { tone: "var(--tone-moss)", fill: "var(--tone-moss-fill)" },
  slate: { tone: "var(--tone-slate)", fill: "var(--tone-slate-fill)" },
};

const URGENCY_VARS: Record<Urgency, string> = {
  emergency: "var(--u-emergency)",
  urgent: "var(--u-urgent)",
  routine: "var(--u-routine)",
  quote: "var(--u-quote)",
};

function isUrgency(value: string): value is Urgency {
  return value === "emergency" || value === "urgent" || value === "routine" || value === "quote";
}

/** Minutes past midnight, in the viewer's local time. */
function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

interface Placed {
  visit: VisitRow;
  start: number;
  end: number;
  /** Which of the side by side columns this visit sits in, and how many there are. */
  column: number;
  columns: number;
}

/**
 * Two jobs on one technician at the same hour have to sit beside each other
 * rather than on top of each other, or the board looks broken. Overlapping
 * visits are gathered into a cluster and each one takes the first free column.
 */
function placeVisits(rows: VisitRow[]): Placed[] {
  const sorted = rows
    .map((visit) => ({
      visit,
      start: minutesOfDay(visit.startAt),
      end: Math.max(minutesOfDay(visit.startAt) + 15, minutesOfDay(visit.endAt)),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const width = cluster.reduce((max, p) => Math.max(max, p.column + 1), 1);
    for (const p of cluster) p.columns = width;
    out.push(...cluster);
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const row of sorted) {
    if (row.start >= clusterEnd && cluster.length > 0) flush();

    // The first column whose last visit has already finished.
    const ends = new Map<number, number>();
    for (const p of cluster) ends.set(p.column, Math.max(ends.get(p.column) ?? 0, p.end));
    let column = 0;
    while ((ends.get(column) ?? 0) > row.start) column += 1;

    cluster.push({ ...row, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, row.end);
  }
  if (cluster.length > 0) flush();

  return out;
}

function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "am" : "pm"}`;
}

export default function DispatchBoard({ board, visits, dayOffset, loaded }: DispatchBoardProps) {
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  const seen = useRef<Set<string> | null>(null);
  const dayKey = String(board?.dayOffset ?? dayOffset);
  const lastKey = useRef(dayKey);

  // A quiet clock, so the line across today stays honest through a long meeting.
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Anything booked while the client is watching gets one arrival animation.
  // The first load never animates, or the whole seeded week would fly in.
  useEffect(() => {
    if (lastKey.current !== dayKey) {
      lastKey.current = dayKey;
      seen.current = null;
      setFresh(new Set());
    }

    if (seen.current === null) {
      if (!loaded) return;
      seen.current = new Set(visits.map((v) => v.id));
      return;
    }

    const arrivals: string[] = [];
    for (const v of visits) {
      if (!seen.current.has(v.id)) {
        seen.current.add(v.id);
        if (v.createdByAgent) arrivals.push(v.id);
      }
    }
    if (arrivals.length === 0) return;

    setFresh((prev) => {
      const next = new Set(prev);
      for (const id of arrivals) next.add(id);
      return next;
    });

    const timer = window.setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const id of arrivals) next.delete(id);
        return next;
      });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [visits, dayKey, loaded]);

  const startHour = board?.startHour ?? DAY_START_HOUR;
  const endHour = board?.endHour ?? DAY_END_HOUR;
  const dayMinutes = Math.max(60, (endHour - startHour) * 60);
  const technicians = useMemo(() => board?.technicians ?? [], [board]);

  const byTechnician = useMemo(() => {
    const grouped = new Map<string, VisitRow[]>();
    for (const t of technicians) grouped.set(t.id, []);
    for (const v of visits) {
      const list = grouped.get(v.assignedTechnicianId);
      if (list) list.push(v);
    }
    const map = new Map<string, Placed[]>();
    for (const [id, rows] of grouped) map.set(id, placeVisits(rows));
    return map;
  }, [visits, technicians]);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = startHour; h <= endHour; h++) out.push(h);
    return out;
  }, [startHour, endHour]);

  const slots = Math.max(1, Math.round(dayMinutes / SLOT_MINUTES));
  const pct = (minutes: number) => `${(minutes / dayMinutes) * 100}%`;

  const nowTop =
    dayOffset === 0 &&
    nowMinutes !== null &&
    nowMinutes >= startHour * 60 &&
    nowMinutes <= endHour * 60
      ? pct(nowMinutes - startHour * 60)
      : null;

  const agentCount = visits.filter((v) => v.createdByAgent).length;
  const dayLabel = board ? DAY_FMT.format(new Date(board.date)) : "";

  const style = {
    "--lanes": String(Math.max(1, technicians.length)),
    "--slots": String(slots),
  } as React.CSSProperties;

  return (
    <section className="panel" aria-label="Dispatch board">
      <div className="panel-head">
        <h2 className="panel-title">Dispatch</h2>
        <p className="panel-sub">{dayLabel}</p>
        <div className="panel-head-end">
          <span className={`tag${agentCount > 0 ? " tag-accent" : ""} num`}>
            {agentCount} booked by the agent
          </span>
        </div>
      </div>

      <div className="panel-body">
        {technicians.length === 0 ? (
          <div className="empty">
            {loaded ? (
              <>
                <strong>No technicians on the board.</strong> Check the roster in
                lib/config.ts.
              </>
            ) : (
              <>Loading the day.</>
            )}
          </div>
        ) : (
          <div className="board">
            <div className="board-head" style={style}>
              <div className="board-corner" />
              {technicians.map((t) => (
                <div
                  key={t.id}
                  className="lane-head"
                  style={{ ["--tone" as string]: TONE_VARS[t.tone].tone }}
                >
                  <div className="lane-name">{t.name}</div>
                  <div className="lane-role">
                    {t.onCall ? (
                      <>
                        <span className="oncall-mark">ON CALL</span>
                        <span>tonight</span>
                      </>
                    ) : (
                      <span>day shift</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="board-scroll scroll">
              <div className="board-body" style={style}>
                <div className="time-col">
                  {hours.map((h) => (
                    <div key={h} className="time-mark" style={{ top: pct((h - startHour) * 60) }}>
                      {hourLabel(h)}
                    </div>
                  ))}
                </div>

                {technicians.map((t) => {
                  const tone = TONE_VARS[t.tone];
                  const rows = byTechnician.get(t.id) ?? [];
                  return (
                    <div
                      key={t.id}
                      className="lane"
                      style={{
                        ["--tone" as string]: tone.tone,
                        ["--tone-fill" as string]: tone.fill,
                      }}
                    >
                      {hours.slice(1).map((h) => (
                        <div
                          key={h}
                          className="lane-hour"
                          style={{ top: pct((h - startHour) * 60) }}
                        />
                      ))}

                      {nowTop ? <div className="now-line" style={{ top: nowTop }} /> : null}

                      {rows.map((placed) => {
                        const v = placed.visit;
                        const top = Math.max(0, Math.min(placed.start - startHour * 60, dayMinutes));
                        const height = Math.max(
                          18,
                          Math.min(placed.end - startHour * 60, dayMinutes) - top,
                        );
                        const compact = (height / dayMinutes) * 100 < 6;
                        const urgency = isUrgency(v.urgency) ? v.urgency : "routine";
                        const when = TIME_FMT.format(new Date(v.startAt));
                        const span = 100 / placed.columns;

                        return (
                          <div
                            key={v.id}
                            className={[
                              "visit",
                              v.createdByAgent ? "visit-agent" : "",
                              fresh.has(v.id) ? "visit-new" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={{
                              top: pct(top),
                              height: pct(height),
                              left: `calc(${placed.column * span}% + 3px)`,
                              width: `calc(${span}% - 6px)`,
                              right: "auto",
                              ["--u-stripe" as string]: URGENCY_VARS[urgency],
                            }}
                            title={`${v.clientName}, ${v.title}, ${when}, ${t.name}, ${URGENCY_LABEL[urgency]}${
                              v.createdByAgent ? ", booked by the agent" : ""
                            }`}
                          >
                            {compact ? (
                              <div className="visit-short">
                                <span className="visit-name">{v.clientName}</span>
                                <span className="visit-title">{v.title}</span>
                                {v.createdByAgent ? <span className="agent-badge">AI</span> : null}
                              </div>
                            ) : (
                              <>
                                <div className="visit-name">
                                  {v.clientName}
                                  {v.createdByAgent ? <span className="agent-badge">AI</span> : null}
                                </div>
                                <div className="visit-title">{v.title}</div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="panel-foot">
        <div className="board-legend">
          {(["emergency", "urgent", "routine", "quote"] as Urgency[]).map((u) => (
            <span className="legend-item" key={u}>
              <span
                className="legend-swatch"
                style={{ ["--tone" as string]: URGENCY_VARS[u] }}
              />
              {URGENCY_LABEL[u]}
            </span>
          ))}
          <span className="legend-item">
            <span className="legend-swatch is-agent" />
            Booked by the agent
          </span>
          <span className="legend-item legend-note">
            Surnames are shortened to an initial on purpose, the board is often on a wall.
          </span>
        </div>
      </div>
    </section>
  );
}
