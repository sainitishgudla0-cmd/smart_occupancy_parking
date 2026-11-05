"use client";

import { Fragment, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { Segmented } from "@/components/Controls";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { query, useApi } from "@/lib/api";
import { formatDate, num, pct } from "@/lib/format";
import { clusterColor } from "@/lib/series";
import type { ClusterReport, ZoneComparison } from "@/lib/types";
import { useFilters } from "@/lib/useFilters";

const WINDOWS = [
  { value: "all", label: "All data" },
  { value: "30", label: "Final 30 days" },
  { value: "14", label: "Final 14 days" },
  { value: "7", label: "Final 7 days" },
];

// One-hue sequential ramp, light to dark.
const RAMP = [
  [205, 226, 251],
  [109, 167, 236],
  [37, 106, 191],
  [13, 54, 107],
];

function heatColor(rate: number): string {
  const position = Math.max(0, Math.min(1, rate)) * (RAMP.length - 1);
  const low = Math.floor(position);
  const high = Math.min(RAMP.length - 1, low + 1);
  const t = position - low;
  const mix = RAMP[low].map((channel, i) => Math.round(channel + (RAMP[high][i] - channel) * t));
  return `rgb(${mix.join(",")})`;
}

export default function ZonesPage() {
  const { get, setFilters } = useFilters();
  const windowValue = get("window") ?? "all";
  const dayType = get("day") ?? "all";

  const zones = useApi<ZoneComparison>(
    query("/api/zones", { days: windowValue === "all" ? null : windowValue, day_type: dayType }),
  );
  const clusters = useApi<ClusterReport>("/api/clusters");

  const data = zones.data;
  const ranked = data
    ? [...data.zones].filter((z) => z.mean_rate !== null).sort((a, b) => (b.mean_rate ?? 0) - (a.mean_rate ?? 0))
    : [];
  const hidden = data ? data.zones.filter((z) => z.mean_rate === null) : [];
  const heatOrder = data ? ranked.map((z) => data.heatmap.find((h) => h.zone === z.zone)!) : [];

  return (
    <>
      <header className="page-head">
        <h1>Zone comparison and clusters</h1>
        <p>How the 28 modelled car parks differ across the operating window, and which ones share a demand pattern.</p>
      </header>

      <div className="filters">
        <Segmented
          label="Time range"
          value={windowValue}
          options={WINDOWS}
          onChange={(value) => setFilters({ window: value === "all" ? null : value })}
        />
        <Segmented
          label="Day type"
          value={dayType}
          options={[
            { value: "all", label: "All days" },
            { value: "weekday", label: "Weekdays" },
            { value: "weekend", label: "Weekends" },
          ]}
          onChange={(value) => setFilters({ day: value === "all" ? null : value })}
        />
      </div>

      {zones.error ? <ErrorState message={zones.error} onRetry={zones.retry} /> : null}
      {!data && !zones.error ? <Skeleton height={420} /> : null}

      <div className="stack">
        {data ? (
          <div className={`stack chart-wrap ${zones.loading ? "is-refreshing" : ""}`}>
            <section className="card fade-in" aria-labelledby="heat-title">
              <div className="card-head">
                <h2 id="heat-title">Average occupancy by time of day</h2>
                <p>
                  {data.first_date && data.last_date
                    ? `Percent of capacity, ${formatDate(data.first_date)} to ${formatDate(data.last_date)}, ${data.days_selected} calendar days selected. Sorted by average occupancy.`
                    : "No days match this selection."}
                </p>
              </div>
              {ranked.length === 0 ? (
                <EmptyState title="No readings match these filters">Widen the time range or choose all days.</EmptyState>
              ) : (
                <Heatmap rows={heatOrder} slots={data.slots} />
              )}
              {hidden.length ? (
                <p className="small" style={{ marginTop: 10 }}>
                  Too few readings to summarize in this selection: {hidden.map((z) => z.zone).join(", ")}.
                </p>
              ) : null}
            </section>

            <section className="card fade-in" aria-labelledby="table-title">
              <details>
                <summary id="table-title">Show zone statistics as a table</summary>
                <p className="small" style={{ marginBottom: 8 }}>
                  Time-of-day values for each car park are available from the API at /api/zones.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Car park</th>
                        <th className="num">Capacity</th>
                        <th className="num">Average</th>
                        <th className="num">90th percentile</th>
                        <th className="num">Share of readings at 95%+</th>
                        <th className="num">Readings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((z) => (
                        <tr key={z.zone}>
                          <td>{z.zone}</td>
                          <td className="num">{num(z.capacity)}</td>
                          <td className="num">{pct(z.mean_rate, 1)}</td>
                          <td className="num">{pct(z.peak_rate, 1)}</td>
                          <td className="num">{pct(z.share_near_full, 1)}</td>
                          <td className="num">{num(z.observations)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          </div>
        ) : null}

        {clusters.error ? <ErrorState message={clusters.error} onRetry={clusters.retry} /> : null}
        {clusters.data ? <ClusterSection report={clusters.data} /> : null}
      </div>
    </>
  );
}

function Heatmap({ rows, slots }: { rows: { zone: string; cells: (number | null)[] }[]; slots: string[] }) {
  const [readout, setReadout] = useState<string | null>(null);
  return (
    <>
      <div className="heat-scroll" tabIndex={0} role="group" aria-label="Heatmap of occupancy by car park and time, scrollable">
        <div className="heat" onPointerLeave={() => setReadout(null)}>
          <div />
          {slots.map((slot, i) => (
            <div className="heat-col" key={slot}>{i % 2 === 0 ? slot.slice(0, 2) : ""}</div>
          ))}
          {rows.map((row) => (
            <Fragment key={row.zone}>
              <div className="heat-zone" title={row.zone}>{row.zone}</div>
              {row.cells.map((value, i) => {
                const text = `${row.zone}, ${slots[i]}: ${value === null ? "no readings" : pct(value, 1)}`;
                return (
                  <div
                    key={slots[i]}
                    className="heat-cell"
                    role="img"
                    aria-label={text}
                    onPointerEnter={() => setReadout(text)}
                    onClick={() => setReadout(text)}
                    style={{ background: value === null ? "var(--seq-empty)" : heatColor(value) }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="heat-scale">
        <span>0%</span>
        <span className="heat-gradient" aria-hidden="true" />
        <span>100% of capacity.</span>
        <span>Columns show the hour. Gray means no readings.</span>
      </div>
      <p className="heat-readout" aria-live="polite">{readout ?? "Point at or tap a cell to read its value."}</p>
    </>
  );
}

function ClusterSection({ report }: { report: ClusterReport }) {
  const groups = report.clusters.map((cluster) => ({
    ...cluster,
    points: report.zones
      .filter((z) => z.cluster === cluster.id)
      .map((z) => ({ zone: z.zone, x: z.mean_rate * 100, y: z.weekend_gap * 100 })),
  }));

  return (
    <section className="stack" aria-labelledby="cluster-title">
      <div className="card fade-in">
        <div className="card-head">
          <h2 id="cluster-title">Demand-pattern clusters</h2>
          <p>
            {report.method}, on data from {report.data_window}. {report.chosen_k} clusters had the highest silhouette score
            among 2 to 6 ({report.silhouette.toFixed(2)}, a moderate separation). When days were resampled, assignments
            agreed with these at an average adjusted Rand index of {report.stability_ari_mean.toFixed(2)}.
          </p>
        </div>
        <div className="legend" aria-hidden="true">
          {groups.map((g) => (
            <span key={g.id}>
              <i className="key-dot" style={{ background: clusterColor(g.id) }} /> {g.label}
            </span>
          ))}
        </div>
        <div role="img" aria-label="Scatter chart of car parks by average occupancy and weekend difference. Cluster membership is listed below.">
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
              <CartesianGrid stroke="var(--line)" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: "var(--ink-3)", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "var(--line-strong)" }}
                label={{ value: "Average occupancy", position: "insideBottom", offset: -14, fill: "var(--ink-2)", fontSize: 12 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`}
                tick={{ fill: "var(--ink-3)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={44}
                label={{ value: "Weekend minus weekday, pts", angle: -90, position: "insideLeft", offset: 10, dy: 80, fill: "var(--ink-2)", fontSize: 12 }}
              />
              <ZAxis range={[80, 80]} />
              <ReferenceLine y={0} stroke="var(--line-strong)" />
              <Tooltip cursor={false} content={<ScatterTip />} />
              {groups.map((g) => (
                <Scatter
                  key={g.id}
                  name={g.label}
                  data={g.points}
                  fill={clusterColor(g.id)}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="small" style={{ marginTop: 8 }}>{report.caveat}</p>
      </div>

      <div className="grid grid-2">
        {groups.map((g) => (
          <article className="card fade-in" key={g.id}>
            <div className="card-head">
              <h3 style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <i className="key-dot" style={{ background: clusterColor(g.id), display: "inline-block", flex: "none" }} aria-hidden="true" />
                {g.label}
              </h3>
              <p>
                {g.size} car parks. Average {pct(g.center.mean_rate)}, 90th percentile {pct(g.center.peak_rate)}, weekend
                difference {g.center.weekend_gap > 0 ? "+" : ""}
                {(g.center.weekend_gap * 100).toFixed(0)} pts.
              </p>
            </div>
            <div role="img" aria-label={`Average occupancy by time of day for this cluster, from ${pct(g.profile[0].rate)} at 08:00 to ${pct(g.profile[g.profile.length - 1].rate)} at 16:30.`}>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={g.profile} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="time" ticks={["08:00", "12:00", "16:00"]} tick={{ fill: "var(--ink-3)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} />
                  <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v: number) => `${v * 100}%`} tick={{ fill: "var(--ink-3)", fontSize: 11 }} tickLine={false} axisLine={false} width={38} />
                  <Tooltip content={<ProfileTip />} cursor={{ stroke: "var(--ink-3)" }} />
                  <Line dataKey="rate" stroke={clusterColor(g.id)} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="chip-list">
              {g.zones.map((zone) => (
                <span className="chip" key={zone}>{zone}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ScatterTip({ active, payload }: { active?: boolean; payload?: { payload: { zone: string; x: number; y: number } }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-title">{point.zone}</div>
      <div className="tip-row"><b>{point.x.toFixed(0)}%</b><span>average occupancy</span></div>
      <div className="tip-row"><b>{point.y > 0 ? "+" : ""}{point.y.toFixed(0)} pts</b><span>weekend minus weekday</span></div>
    </div>
  );
}

function ProfileTip({ active, payload }: { active?: boolean; payload?: { payload: { time: string; rate: number } }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-title">{point.time}</div>
      <div className="tip-row"><b>{pct(point.rate)}</b><span>cluster average</span></div>
    </div>
  );
}
