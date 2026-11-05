"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CountUp, StatTile } from "@/components/StatTile";
import { ErrorState, Skeleton } from "@/components/States";
import { useApi } from "@/lib/api";
import { formatDate, num, pct } from "@/lib/format";
import { MODEL_COLORS, MODEL_SHORT } from "@/lib/series";
import type { ModelKey, ModelReport } from "@/lib/types";

const MODEL_ORDER: ModelKey[] = ["knn", "svr", "boosting"];
const BASELINE_COLORS: Record<string, string> = { persistence: "var(--ink-3)", seasonal_profile: "var(--ink-2)" };
const BASELINE_SHORT: Record<string, string> = { persistence: "Persistence", seasonal_profile: "Historical average" };
// The two baselines share a gray, so their dash patterns tell them apart.
const BASELINE_DASH: Record<string, string> = { persistence: "2 4", seasonal_profile: "8 4" };

function spanDays(split: { first_date: string; last_date: string }): number {
  return (Date.parse(split.last_date) - Date.parse(split.first_date)) / 86_400_000 + 1;
}

export default function ModelsPage() {
  const { data, error, retry } = useApi<ModelReport>("/api/models");

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data) return <Skeleton height={480} />;

  const best = data.models[data.default_model];
  const seasonal = data.baselines.seasonal_profile;
  const horizonRows = data.horizon_buckets.map((bucket) => {
    const row: Record<string, string | number> = { bucket: bucket.label, short: bucket.label.split(" (")[0] };
    for (const key of MODEL_ORDER) row[key] = data.models[key].test_by_horizon[bucket.id].mae_pct_points;
    for (const key of Object.keys(data.baselines)) row[key] = data.baselines[key].test_by_horizon[bucket.id].mae_pct_points;
    return row;
  });
  const others = Object.entries(data.comparisons_with_default);
  const closeModels = others.filter(([, v]) => !v.distinguishable).map(([k]) => labelFor(k));

  return (
    <>
      <header className="page-head">
        <h1>Model comparison</h1>
        <p>
          Measured results on {data.splits.test.days_scored} held-out days. Models were trained on earlier data, and tuning and
          model choice used validation data only.
        </p>
      </header>

      <div className="stack">
        <div className="grid grid-tiles">
          <StatTile
            label={`Default model: ${MODEL_SHORT[data.default_model]}`}
            value={
              <>
                <CountUp value={best.test.mae_pct_points} format={(v) => v.toFixed(2)} />
                <span style={{ fontSize: "1rem", fontWeight: 560 }}> pts MAE</span>
              </>
            }
            sub={data.default_model_rule}
          />
          <StatTile
            label="Historical-average baseline"
            value={
              <>
                <CountUp value={seasonal.test.mae_pct_points} format={(v) => v.toFixed(2)} />
                <span style={{ fontSize: "1rem", fontWeight: 560 }}> pts MAE</span>
              </>
            }
            sub="The simple forecast a useful model has to beat"
          />
          <StatTile
            label="80% band, measured coverage"
            value={<CountUp value={best.interval_coverage_test.overall} format={(v) => pct(v, 1)} />}
            sub={`${MODEL_SHORT[data.default_model]} on the test days, all car parks together`}
          />
        </div>

        <section className="card fade-in" aria-labelledby="table-title">
          <div className="card-head">
            <h2 id="table-title">
              Test results <span className="badge measured">Measured, not synthetic</span>
            </h2>
            <p>
              Errors are in percentage points of capacity: an MAE of 4 on a 500-space car park is about 20 spaces. Lower MAE and
              RMSE are better. Brackets show 95% intervals from resampling whole test days.
            </p>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">MAE (pts)</th>
                  <th className="num">RMSE (pts)</th>
                  <th className="num">R²</th>
                  <th className="num">Validation RMSE</th>
                  <th className="num">80% band coverage</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_ORDER.map((key) => {
                  const m = data.models[key];
                  return (
                    <tr key={key}>
                      <td>
                        <i className="key-dot" style={{ background: MODEL_COLORS[key], display: "inline-block", marginRight: 8 }} aria-hidden="true" />
                        {m.label}
                        {key === data.default_model ? <span className="badge">Default</span> : null}
                      </td>
                      <td className="num">
                        {m.test.mae_pct_points.toFixed(2)} [{m.test.mae_ci95?.[0].toFixed(2)}, {m.test.mae_ci95?.[1].toFixed(2)}]
                      </td>
                      <td className="num">
                        {m.test.rmse_pct_points.toFixed(2)} [{m.test.rmse_ci95?.[0].toFixed(2)}, {m.test.rmse_ci95?.[1].toFixed(2)}]
                      </td>
                      <td className="num">{m.test.r2.toFixed(3)}</td>
                      <td className="num">{m.validation.rmse_pct_points.toFixed(2)}</td>
                      <td className="num">{pct(m.interval_coverage_test.overall, 1)}</td>
                    </tr>
                  );
                })}
                {Object.entries(data.baselines).map(([key, b]) => (
                  <tr key={key} className="row-muted">
                    <td>Baseline: {b.label}</td>
                    <td className="num">
                      {b.test.mae_pct_points.toFixed(2)} [{b.test.mae_ci95?.[0].toFixed(2)}, {b.test.mae_ci95?.[1].toFixed(2)}]
                    </td>
                    <td className="num">
                      {b.test.rmse_pct_points.toFixed(2)} [{b.test.rmse_ci95?.[0].toFixed(2)}, {b.test.rmse_ci95?.[1].toFixed(2)}]
                    </td>
                    <td className="num">{b.test.r2.toFixed(3)}</td>
                    <td className="num">{b.validation.rmse_pct_points.toFixed(2)}</td>
                    <td className="num">n/a</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14 }}>
            <p className="note">
              {closeModels.length
                ? `The test period cannot separate ${MODEL_SHORT[data.default_model]} from ${closeModels.join(" or ")}: the 95% interval on their paired MAE difference includes zero. Treat them as similar on this data.`
                : `${MODEL_SHORT[data.default_model]} differs from every other method here by more than the paired 95% interval.`}
            </p>
            <p className="note">
              R² looks high partly because car parks and times of day differ so much from one another. The historical average
              alone reaches {seasonal.test.r2.toFixed(2)}, so the gap to that baseline is the fairer measure of what the models add.
            </p>
            <p className="note">
              Training rows differ because KNN and SVR become slow and large on big datasets, so they use random samples while
              boosting uses all rows. This is a comparison of these fitted models, not of each method&apos;s best possible result.
            </p>
          </div>
          <details style={{ marginTop: 10 }}>
            <summary>Show training and serving details</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="num">Training rows</th>
                    <th className="num">Model file</th>
                    <th className="num">Time for 504 predictions</th>
                    <th>Settings chosen on validation data</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_ORDER.map((key) => {
                    const m = data.models[key];
                    return (
                      <tr key={key}>
                        <td>{m.label}</td>
                        <td className="num">{num(m.training_rows)}</td>
                        <td className="num">{(m.artifact_bytes / 1e6).toFixed(2)} MB</td>
                        <td className="num">{m.batch_504_rows_ms.toFixed(0)} ms</td>
                        <td>{Object.entries(m.best_params).map(([name, value]) => `${name}=${value}`).join(", ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              Timings were measured on the training computer and will differ on Vercel.
            </p>
          </details>
        </section>

        <section className="card fade-in" aria-labelledby="horizon-title">
          <div className="card-head">
            <h2 id="horizon-title">Error grows with horizon</h2>
            <p>Test MAE in percentage points of capacity (vertical axis), by how many half-hour operating slots ahead the forecast looks.</p>
          </div>
          <div className="legend" aria-hidden="true">
            {MODEL_ORDER.map((key) => (
              <span key={key}><i className="key-line" style={{ borderColor: MODEL_COLORS[key] }} /> {MODEL_SHORT[key]}</span>
            ))}
            {Object.keys(data.baselines).map((key) => (
              <span key={key}>
                <svg width="30" height="4" viewBox="0 0 30 4">
                  <line x1="0" y1="2" x2="30" y2="2" stroke={BASELINE_COLORS[key]} strokeWidth="2" strokeDasharray={BASELINE_DASH[key]} />
                </svg>{" "}
                {BASELINE_SHORT[key]}
              </span>
            ))}
          </div>
          <div role="img" aria-label="Test error by forecast horizon for each model and baseline. Values are in the table below.">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={horizonRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="short" tick={{ fill: "var(--ink-3)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} interval={0} padding={{ left: 28, right: 28 }} />
                <YAxis domain={[0, "auto"]} tickFormatter={(v: number) => `${v}`} tick={{ fill: "var(--ink-3)", fontSize: 12 }} tickLine={false} axisLine={false} width={32} />
                <Tooltip content={<HorizonTip />} cursor={{ stroke: "var(--ink-3)" }} />
                {Object.keys(data.baselines).map((key) => (
                  <Line key={key} dataKey={key} stroke={BASELINE_COLORS[key]} strokeWidth={2} strokeDasharray={BASELINE_DASH[key]} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: BASELINE_COLORS[key] }} isAnimationActive={false} />
                ))}
                {MODEL_ORDER.map((key) => (
                  <Line key={key} dataKey={key} stroke={MODEL_COLORS[key]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: MODEL_COLORS[key] }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details style={{ marginTop: 10 }}>
            <summary>Show horizon results as a table</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Horizon</th>
                    {MODEL_ORDER.map((key) => <th className="num" key={key}>{MODEL_SHORT[key]} MAE</th>)}
                    {Object.keys(data.baselines).map((key) => <th className="num" key={key}>{BASELINE_SHORT[key]} MAE</th>)}
                    {MODEL_ORDER.map((key) => <th className="num" key={key}>{MODEL_SHORT[key]} band coverage</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.horizon_buckets.map((bucket, i) => (
                    <tr key={bucket.id}>
                      <td>{bucket.label}</td>
                      {MODEL_ORDER.map((key) => <td className="num" key={key}>{Number(horizonRows[i][key]).toFixed(2)}</td>)}
                      {Object.keys(data.baselines).map((key) => <td className="num" key={key}>{Number(horizonRows[i][key]).toFixed(2)}</td>)}
                      {MODEL_ORDER.map((key) => <td className="num" key={key}>{pct(data.models[key].interval_coverage_test[bucket.id], 1)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section className="card fade-in" aria-labelledby="split-title">
          <div className="card-head">
            <h2 id="split-title">How the data was split</h2>
            <p>Chronological, so every model is scored only on days after the data it learned from.</p>
          </div>
          <div className="timeline" role="img" aria-label="Train, then validation, then test, in time order">
            <div style={{ flex: spanDays(data.splits.train), background: "var(--accent-wash)" }}>Train</div>
            <div style={{ flex: spanDays(data.splits.validation), background: "var(--surface-2)" }}>Validate</div>
            <div style={{ flex: spanDays(data.splits.test), background: "var(--line-strong)" }}>Test</div>
          </div>
          <dl className="facts" style={{ marginTop: 14 }}>
            <dt>Train</dt>
            <dd>{formatDate(data.splits.train.first_date)} to {formatDate(data.splits.train.last_date)}, {num(data.splits.train.rows)} forecast rows. The first week is used only as history.</dd>
            <dt>Validation</dt>
            <dd>{formatDate(data.splits.validation.first_date)} to {formatDate(data.splits.validation.last_date)}, {num(data.splits.validation.rows)} rows. Used to tune settings, choose the default model, and calibrate bands.</dd>
            <dt>Test</dt>
            <dd>{formatDate(data.splits.test.first_date)} to {formatDate(data.splits.test.last_date)}, {num(data.splits.test.rows)} rows. Scored with final models refit on train and validation, and not used for tuning or model choice.</dd>
          </dl>
          <p className="note" style={{ marginTop: 12 }}>
            A forecast&apos;s origin and target stay in the same split, so no training target falls inside a later period. The test
            period is in December, so it may not represent other seasons.
          </p>
        </section>
      </div>
    </>
  );

  function labelFor(key: string) {
    return key in MODEL_SHORT ? MODEL_SHORT[key as ModelKey] : (BASELINE_SHORT[key] ?? key);
  }
}

function HorizonTip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => a.value - b.value);
  return (
    <div className="tip">
      <div className="tip-title">{label}</div>
      {sorted.map((item) => (
        <div className="tip-row" key={item.dataKey}>
          <i className="key-line" style={{ borderColor: item.color }} />
          <b>{item.value.toFixed(2)}</b>
          <span>{MODEL_SHORT[item.dataKey as ModelKey] ?? BASELINE_SHORT[item.dataKey]}</span>
        </div>
      ))}
    </div>
  );
}
