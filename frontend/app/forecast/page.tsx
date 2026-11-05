"use client";

import Link from "next/link";
import { useMemo } from "react";

import { AsOfPicker, Field, Segmented } from "@/components/Controls";
import { ForecastChart } from "@/components/ForecastChart";
import { CountUp, StatTile } from "@/components/StatTile";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { query, useApi } from "@/lib/api";
import { formatDateTime, num, pct, timeOf } from "@/lib/format";
import { MODEL_SHORT } from "@/lib/series";
import type { Forecast, Meta, ModelKey, ModelReport } from "@/lib/types";
import { useFilters } from "@/lib/useFilters";

const HORIZONS = [
  { value: "4", label: "Next 4 slots (2 h)" },
  { value: "8", label: "Next 8 slots (4 h)" },
  { value: "18", label: "Next 18 slots (full operating day)" },
];

export default function ForecastPage() {
  const { get, setFilters } = useFilters();
  const meta = useApi<Meta>("/api/meta");
  const report = useApi<ModelReport>("/api/models");

  const zone = get("zone") ?? "Broad Street";
  const steps = get("steps") ?? "8";
  const asOf = get("as_of");
  const model = get("model") ?? meta.data?.default_model ?? null;

  const url = model ? query("/api/forecast", { zone, model, steps, as_of: asOf }) : null;
  const forecast = useApi<Forecast>(url);

  const replayError = useMemo(() => {
    const data = forecast.data;
    if (!data || data.status !== "ok" || !data.is_replay) return null;
    const out: Partial<Record<ModelKey, { mae: number; n: number }>> = {};
    for (const key of Object.keys(data.models) as ModelKey[]) {
      const errors = data.points
        .map((point, i) => (point.actual === null ? null : Math.abs(point.actual - (data.models[key]?.[i]?.rate ?? 0))))
        .filter((value): value is number => value !== null);
      if (errors.length) out[key] = { mae: errors.reduce((a, b) => a + b, 0) / errors.length, n: errors.length };
    }
    return out;
  }, [forecast.data]);

  if (meta.error) return <ErrorState message={meta.error} onRetry={meta.retry} />;
  if (!meta.data) return <Skeleton height={480} />;

  const m = meta.data;
  const data = forecast.data;
  const singleKey = model !== "all" ? (model as ModelKey) : null;
  const first = data && singleKey ? data.models[singleKey]?.[0] : null;
  const firstPoint = data?.points[0];
  const peak =
    data && singleKey
      ? (data.models[singleKey] ?? []).reduce<{ rate: number; time: string } | null>((best, value, i) => {
          return !best || value.rate > best.rate ? { rate: value.rate, time: data.points[i].time } : best;
        }, null)
      : null;
  const crossesOvernight = data?.points.some((p) => p.crosses_overnight);
  const widths = singleKey ? report.data?.models[singleKey] : null;

  return (
    <>
      <header className="page-head">
        <h1>Occupancy forecast</h1>
        <p>
          Forecasts for one car park, starting from the latest reading or any time in the held-out test period, where you
          can compare them with what actually happened.
        </p>
      </header>

      <div className="filters">
        <Field label="Car park" id="zone-select">
          <select
            id="zone-select"
            className="select"
            value={zone}
            onChange={(event) => setFilters({ zone: event.target.value })}
          >
            {m.zones.map((z) => (
              <option key={z.zone} value={z.zone}>
                {z.zone} ({num(z.capacity)} spaces)
              </option>
            ))}
          </select>
        </Field>
        <Segmented
          label="Model"
          value={model ?? m.default_model}
          options={[
            { value: "knn", label: "KNN" },
            { value: "svr", label: "SVR" },
            { value: "boosting", label: "Boosting" },
            { value: "all", label: "Compare all" },
          ]}
          onChange={(value) => setFilters({ model: value })}
        />
        <Field label="Horizon" id="horizon-select">
          <select
            id="horizon-select"
            className="select"
            value={steps}
            onChange={(event) => setFilters({ steps: event.target.value })}
          >
            {HORIZONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
        <AsOfPicker
          value={asOf}
          days={m.replay.days}
          slots={m.replay.slots}
          onChange={(value) => setFilters({ as_of: value })}
        />
      </div>

      {forecast.error ? <ErrorState message={forecast.error} onRetry={forecast.retry} /> : null}
      {!data && !forecast.error ? <Skeleton height={420} /> : null}

      {data ? (
        <div className={`stack chart-wrap ${forecast.loading ? "is-refreshing" : ""}`}>
          <section className="card fade-in" aria-labelledby="forecast-title">
            <div className="card-head">
              <h2 id="forecast-title">
                {data.zone}: occupancy, percent of {num(data.capacity)} spaces
              </h2>
              <p>
                Forecast made at {formatDateTime(data.as_of)}{" "}
                {data.is_replay ? "(replay of a held-out time)" : "(the end of the dataset, so no outcomes exist to compare)"}.
              </p>
            </div>
            {data.status === "no_recent_reading" ? (
              <EmptyState title="No forecast for this time">
                <p>{data.message}</p>
                <p className="small" style={{ marginTop: 6 }}>
                  Last reading: {data.last_observed ? formatDateTime(data.last_observed) : "none"}. Choose another car park or
                  an earlier replay time.
                </p>
              </EmptyState>
            ) : (
              <ForecastChart forecast={data} />
            )}
          </section>

          {data.status === "ok" ? (
            <>
              <div className="grid grid-tiles">
                {first && firstPoint ? (
                  <StatTile
                    label={`Forecast for ${timeOf(firstPoint.time)}`}
                    value={<CountUp value={first.rate} format={(v) => pct(v)} />}
                    sub={`80% band ${pct(first.lower)} to ${pct(first.upper)}, about ${num(Math.round(first.rate * data.capacity))} spaces`}
                  />
                ) : null}
                {peak ? (
                  <StatTile
                    label="Highest forecast in this horizon"
                    value={<CountUp value={peak.rate} format={(v) => pct(v)} />}
                    sub={`At ${formatDateTime(peak.time)}`}
                  />
                ) : null}
                {replayError
                  ? (Object.entries(replayError) as [ModelKey, { mae: number; n: number }][]).map(([key, value]) => (
                      <StatTile
                        key={key}
                        label={`${MODEL_SHORT[key]} error on this replay`}
                        value={
                          <>
                            <CountUp value={value.mae * 100} format={(v) => v.toFixed(1)} />
                            <span style={{ fontSize: "1rem", fontWeight: 560 }}> pts</span>
                          </>
                        }
                        sub={`Mean absolute error over ${value.n} slots. One replay is an example, not an overall score.`}
                      />
                    ))
                  : null}
                {!data.is_replay && widths ? (
                  <StatTile
                    label="Measured test MAE of this model"
                    value={
                      <>
                        <CountUp value={widths.test.mae_pct_points} format={(v) => v.toFixed(1)} />
                        <span style={{ fontSize: "1rem", fontWeight: 560 }}> pts</span>
                      </>
                    }
                    sub="Percentage points of capacity, all horizons"
                  />
                ) : null}
              </div>

              <section className="card fade-in" aria-labelledby="reading-title">
                <div className="card-head">
                  <h2 id="reading-title">How to read this forecast</h2>
                </div>
                {crossesOvernight ? (
                  <p className="note">
                    <strong>This horizon crosses overnight.</strong> The dataset has no readings between about 16:30 and
                    08:00, so a step after 16:30 lands on 08:00 the next day. Horizons count operating slots, not clock hours.
                  </p>
                ) : null}
                <p className="note">
                  {singleKey ? "The shaded 80% band" : "The 80% band, shown when one model is selected and listed in the table below,"}{" "}
                  comes from each model&apos;s errors on validation data at a similar horizon. It applies across all car parks
                  together, so it can be too narrow or too wide for a particular one. Its measured coverage is on
                  the <Link href="/models">Models page</Link>.
                </p>
                <p className="note">
                  Forecasts use past occupancy and the calendar only. The source has no data on events, weather, prices or
                  closures, so the models cannot anticipate them.
                </p>
                <details style={{ marginTop: 10 }}>
                  <summary>Show forecast values as a table</summary>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Target time</th>
                          <th className="num">Slots ahead</th>
                          {(Object.keys(data.models) as ModelKey[]).map((key) => (
                            <th className="num" key={key}>
                              {MODEL_SHORT[key]} (80% band)
                            </th>
                          ))}
                          <th className="num">Actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.points.map((point, i) => (
                          <tr key={point.time}>
                            <td>{formatDateTime(point.time)}</td>
                            <td className="num">{point.horizon}</td>
                            {(Object.keys(data.models) as ModelKey[]).map((key) => {
                              const value = data.models[key]?.[i];
                              return (
                                <td className="num" key={key}>
                                  {value ? `${pct(value.rate, 1)} (${pct(value.lower)} to ${pct(value.upper)})` : "n/a"}
                                </td>
                              );
                            })}
                            <td className="num">{point.actual === null ? "not available" : pct(point.actual, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
