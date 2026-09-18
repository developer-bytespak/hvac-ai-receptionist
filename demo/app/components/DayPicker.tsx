"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Picks the day the board shows. The rest of the app thinks in whole days
 * from today (the state endpoint takes `day=N`), so this converts a calendar
 * date to that offset and back. Past days are not selectable: the demo
 * only writes forward.
 */
type Props = {
  dayOffset: number;
  onChange: (offset: number) => void;
  /** How many days ahead the schedule is seeded. Days past this are shown, but empty. */
  seededDays?: number;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const SHORT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function offsetBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

export function dayLabel(offset: number): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return SHORT.format(addDays(new Date(), offset));
}

export default function DayPicker({ dayOffset, onChange, seededDays = 14 }: Props) {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => startOfDay(new Date()), []);
  const selected = addDays(today, dayOffset);
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const root = useRef<HTMLDivElement>(null);

  // Opening always lands on the month of the selected day.
  useEffect(() => {
    if (open) setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = first.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const pick = (offset: number) => {
    onChange(Math.max(0, offset));
    setOpen(false);
  };

  const canGoBack = month > new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <div className="daypick" ref={root}>
      <button
        type="button"
        className="daypick-step"
        aria-label="Previous day"
        disabled={dayOffset === 0}
        onClick={() => onChange(dayOffset - 1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>

      <button
        type="button"
        className="daypick-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg className="daypick-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
        </svg>
        <span className="daypick-label">{dayLabel(dayOffset)}</span>
        {dayOffset <= 1 ? <span className="daypick-date">{SHORT.format(selected)}</span> : null}
      </button>

      <button
        type="button"
        className="daypick-step"
        aria-label="Next day"
        onClick={() => onChange(dayOffset + 1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>

      {open ? (
        <div className="daypick-pop" role="dialog" aria-label="Choose a day">
          <div className="daypick-head">
            <button
              type="button"
              className="daypick-nav"
              aria-label="Previous month"
              disabled={!canGoBack}
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span className="daypick-month">{MONTH.format(month)}</span>
            <button
              type="button"
              className="daypick-nav"
              aria-label="Next month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          <div className="daypick-grid" role="grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="daypick-wd" role="columnheader">
                {w}
              </span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} className="daypick-empty" />;
              const off = offsetBetween(today, d);
              const past = off < 0;
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  role="gridcell"
                  className={`daypick-day${off === dayOffset ? " is-selected" : ""}${off === 0 ? " is-today" : ""}${off > 0 && off <= seededDays ? " has-data" : ""}`}
                  disabled={past}
                  aria-selected={off === dayOffset}
                  onClick={() => pick(off)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="daypick-foot">
            <button type="button" className="daypick-quick" onClick={() => pick(0)}>
              Today
            </button>
            <button type="button" className="daypick-quick" onClick={() => pick(1)}>
              Tomorrow
            </button>
            <button type="button" className="daypick-quick" onClick={() => pick(7)}>
              Next week
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
