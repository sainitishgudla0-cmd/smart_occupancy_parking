"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDateShort, formatDateTime, pct, timeOf } from "@/lib/format";
import { MODEL_COLORS, MODEL_SHORT } from "@/lib/series";
import type { Forecast, ModelKey } from "@/lib/types";

const CONTEXT_SLOTS = 18;
const MODEL_ORDER: ModelKey[] = ["knn", "svr", "boosting"];

type Row = {
  time: string;
  observed?: number | null;
  actual?: number | null;
  band?: [number, number];
} & Partial<Record<ModelKey, number>>;

function buildRows(forecast: Forecast, models: ModelKey[]): Row[] {
  const history = forecast.history.slice(-CONTEXT_SLOTS);
  const rows: Row[] = history.map((point) => ({ time: point.time, observed: point.rate }));
  const anchor = rows[rows.length - 1];
  if (anchor && anchor.observed !== null && anchor.observed !== undefined) {
    // Forecast lines start from the last observed value so the eye can follow them.
    for (const model of models) anchor[model] = anchor.observed;
    if (models.length === 1) anchor.band = [anchor.observed, anchor.observed];
  }
  forecast.points.forEach((point, index) => {
    const row: Row = { time: point.time, actual: point.actual };
    for (const model of models) {
      const value = forecast.models[model]?.[index];
      if (value) {
        row[model] = value.rate;
        if (models.length === 1) row.band = [value.lower, value.upper];
      }
    }
    rows.push(row);
  });
  return rows;
}

export function ForecastChart({ forecast, height = 360 }: { forecast: Forecast; height?: number }) {
  const models = MODEL_ORDER.filter((model) => forecast.models[model]);
  const single = models.length === 1 ? models[0] : null;
  const rows = useMemo(() => buildRows(forecast, models), [forecast, models]);
  const hasActuals = forecast.points.some((p) => p.actual !== null);

  const dayStarts = rows.filter((row, i) => i > 0 && timeOf(row.time) === "08:00").map((row) => row.time);
  const ticks = rows
    .map((row) => row.time)
    .filter((time) => {
      const clock = timeOf(time);
      return clock.endsWith(":00") && Number(clock.slice(0, 2)) % 2 === 0;
    });

  return (
    <div>
      <div className="legend" aria-hidden="true">
        <span><i className="key-line" style={{ borderColor: "var(--observed)" }} /> Observed</span>
        {hasActuals ? (
          <span><i className="key-line key-dash" style={{ borderColor: "var(--observed)" }} /> What actually happened</span>
        ) : null}
        {models.map((model) => (
          <span key={model}>
            <i className="key-line" style={{ borderColor: MODEL_COLORS[model] }} /> {MODEL_SHORT[model]} forecast
          </span>
        ))}
        {single ? (
          <span><i className="key-band" style={{ background: MODEL_COLORS[single] }} /> 80% prediction band</span>
        ) : null}
      </div>
      <div
        role="img"
        aria-label={`Occupancy in percent for ${forecast.zone}. Observed readings up to ${formatDateTime(
          forecast.as_of,
        )}, followed by forecasts. The same values are in the table below the chart.`}
      >
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={rows} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="time"
              ticks={ticks}
              tickFormatter={timeOf}
              tick={{ fill: "var(--ink-3)", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line-strong)" }}
              minTickGap={18}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              tick={{ fill: "var(--ink-3)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            {dayStarts.map((time) => (
              <ReferenceLine
                key={time}
                x={time}
                stroke="var(--line-strong)"
                label={{ value: formatDateShort(time), position: "insideTopLeft", fill: "var(--ink-3)", fontSize: 11, dy: -20 }}
              />
            ))}
            <ReferenceLine
              x={forecast.as_of}
              stroke="var(--ink-2)"
              label={{ value: "Forecast starts", position: "insideBottomRight", fill: "var(--ink-2)", fontSize: 11 }}
            />
            <Tooltip content={<ForecastTooltip models={models} asOf={forecast.as_of} />} cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }} />
            {single ? (
              <Area
                dataKey="band"
                stroke="none"
                fill={MODEL_COLORS[single]}
                fillOpacity={0.16}
                isAnimationActive={false}
                connectNulls
                activeDot={false}
              />
            ) : null}
            <Line dataKey="observed" stroke="var(--observed)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} activeDot={{ r: 4 }} />
            <Line dataKey="actual" stroke="var(--observed)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} activeDot={{ r: 4 }} />
            {models.map((model) => (
              <Line
                key={model}
                dataKey={model}
                stroke={MODEL_COLORS[model]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ForecastTooltip({
  active,
  payload,
  models,
  asOf,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
  models: ModelKey[];
  asOf: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const isFuture = row.time > asOf;
  return (
    <div className="tip">
      <div className="tip-title">{formatDateTime(row.time)}</div>
      {!isFuture && row.observed === null ? <div className="tip-row"><span>No reading in this slot</span></div> : null}
      {!isFuture && row.observed !== null && row.observed !== undefined ? (
        <div className="tip-row">
          <i className="key-line" style={{ borderColor: "var(--observed)" }} />
          <b>{pct(row.observed, 1)}</b>
          <span>observed</span>
        </div>
      ) : null}
      {isFuture
        ? models.map((model) => (
            <div className="tip-row" key={model}>
              <i className="key-line" style={{ borderColor: MODEL_COLORS[model] }} />
              <b>{pct(row[model], 1)}</b>
              <span>{MODEL_SHORT[model]} forecast</span>
            </div>
          ))
        : null}
      {isFuture && row.band ? (
        <div className="tip-row"><span>80% band {pct(row.band[0])} to {pct(row.band[1])}</span></div>
      ) : null}
      {isFuture && row.actual !== null && row.actual !== undefined ? (
        <div className="tip-row">
          <i className="key-line key-dash" style={{ borderColor: "var(--observed)" }} />
          <b>{pct(row.actual, 1)}</b>
          <span>actually happened</span>
        </div>
      ) : null}
    </div>
  );
}
