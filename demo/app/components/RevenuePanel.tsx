"use client";

/**
 * The number the owner actually came for.
 *
 * Revenue booked is the hero because a missed call after five is not an
 * inconvenience, it is a job that went to whoever answered instead. The
 * caption is not decoration: the figure is built from the typical ticket on
 * each job type, so it has to read as an estimate rather than an invoice.
 */

import { useMemo } from "react";
import type { Totals } from "@/app/hooks/useDemoState";

export interface RevenuePanelProps {
  totals: Totals;
  currency: string;
}

export default function RevenuePanel({ totals, currency }: RevenuePanelProps) {
  const money = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  const revenue = totals.revenue_booked;

  return (
    <section className="panel" aria-label="Recovered revenue">
      <div className="panel-head">
        <h2 className="panel-title">Recovered</h2>
        <p className="panel-sub">Since the last reset</p>
        <div className="panel-head-end">
          <span className={`tag${totals.jobs_booked > 0 ? " tag-ok" : ""} num`}>
            {totals.calls_total} {totals.calls_total === 1 ? "call" : "calls"}
          </span>
        </div>
      </div>

      <div className="panel-body">
        <div className="rev">
          <div className="rev-hero">
            <span className="rev-hero-label">Revenue booked</span>
            <span
              className={`rev-hero-n${revenue === 0 ? " is-zero" : ""}`}
              aria-live="polite"
            >
              {money.format(revenue)}
            </span>
          </div>

          <div className="rev-grid">
            <div className="rev-cell">
              <span className="rev-n num">{totals.calls_after_hours}</span>
              <span className="rev-l">After hours calls</span>
            </div>
            <div className="rev-cell">
              <span className="rev-n num">{totals.jobs_booked}</span>
              <span className="rev-l">Jobs booked</span>
            </div>
            <div className="rev-cell">
              <span className="rev-n num">{totals.visits_by_agent}</span>
              <span className="rev-l">Agent bookings</span>
            </div>
          </div>

          <p className="rev-caption">
            An estimate, not an invoice. Each booking counts at the typical ticket for its job
            type. Swap in your own averages and the figure follows.
          </p>
        </div>
      </div>
    </section>
  );
}
