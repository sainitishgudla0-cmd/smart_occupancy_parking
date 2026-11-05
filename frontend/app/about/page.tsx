"use client";

import { ErrorState, Skeleton } from "@/components/States";
import { useApi } from "@/lib/api";
import { formatDate, num } from "@/lib/format";
import type { Meta } from "@/lib/types";

export default function AboutPage() {
  const { data, error, retry } = useApi<Meta>("/api/meta");
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data) return <Skeleton height={480} />;

  const d = data.dataset;
  const q = data.quality;
  const steps: [string, number][] = [
    ["Exact duplicate rows removed", q.exact_duplicate_rows_removed],
    ["Negative occupancy readings removed", q.negative_occupancy_rows_removed],
    ["Readings above capacity, set to 100% full", q.rows_clipped_to_full],
    ["Readings before 07:45, outside the half-hour grid, removed", q.rows_outside_operating_grid_removed],
    ["Extra readings within the same half-hour slot removed", q.rows_removed_multiple_readings_in_slot],
    ["Readings from frozen sensor runs masked", q.stuck_sensor_readings_masked],
    ["Readings after a sudden within-day collapse masked", q.within_day_collapse_readings_masked],
  ];

  return (
    <>
      <header className="page-head">
        <h1>Data and limitations</h1>
        <p>Where the numbers come from, what was changed, and what this dashboard cannot tell you.</p>
      </header>

      <div className="grid grid-2">
        <section className="card fade-in" aria-labelledby="source-title">
          <div className="card-head"><h2 id="source-title">Source and license</h2></div>
          <dl className="facts">
            <dt>Dataset</dt>
            <dd><a href={d.url} target="_blank" rel="noreferrer">{d.name}</a>, {d.repository}</dd>
            <dt>Creator</dt>
            <dd>{d.creator}</dd>
            <dt>DOI</dt>
            <dd><a href={`https://doi.org/${d.doi}`} target="_blank" rel="noreferrer">{d.doi}</a></dd>
            <dt>License</dt>
            <dd><a href={d.license_url} target="_blank" rel="noreferrer">{d.license}</a></dd>
            <dt>Coverage</dt>
            <dd>{formatDate(d.first_date)} to {formatDate(d.last_date)}, about 08:00 to 16:30</dd>
            <dt>Fields</dt>
            <dd>Car park code, capacity, occupancy, timestamp</dd>
            <dt>Citation</dt>
            <dd>{d.citation}</dd>
            <dt>Changes made</dt>
            <dd>{d.changes}</dd>
          </dl>
        </section>

        <section className="card fade-in" aria-labelledby="clean-title">
          <div className="card-head">
            <h2 id="clean-title">What cleaning changed</h2>
            <p>
              {num(q.raw_rows)} raw rows from {q.raw_zones} car parks became {num(q.clean_observations)} half-hourly readings,
              filling {q.grid_coverage_pct}% of the grid. Missing slots are left empty, not filled in.
            </p>
          </div>
          <div className="table-scroll">
            <table>
              <tbody>
                {steps.map(([label, count]) => (
                  <tr key={label}>
                    <td style={{ whiteSpace: "normal" }}>{label}</td>
                    <td className="num">{num(count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            Excluded for too little data: {q.excluded_zones.map((z) => `${z.zone} (${z.observed_days} days)`).join(", ")}. No data
            on any car park for: {q.calendar_dates_without_any_data.map(formatDate).join(", ")}.
          </p>
        </section>

        <section className="card fade-in" aria-labelledby="limits-title">
          <div className="card-head"><h2 id="limits-title">Limitations</h2></div>
          <ul className="clean note">
            <li><strong>Not live.</strong> The newest reading is from {formatDate(d.last_date)}. Forecasts past that date are a demonstration, not guidance for parking today.</li>
            <li><strong>Short period.</strong> Eleven weeks in autumn 2016 cannot capture yearly seasons, and car parks may have changed since.</li>
            <li><strong>Daytime only.</strong> There are no readings in the evening or overnight, so nothing can be said about those hours.</li>
            <li><strong>Occupancy and calendar only.</strong> There is no data on events, weather, pricing or closures.</li>
            <li><strong>Reported, not verified.</strong> Readings above capacity and frozen runs show the feed has errors. Some remaining errors will not have been caught.</li>
            <li><strong>Time zone not stated.</strong> Times are shown as recorded. Reading times stayed stable across the end of British Summer Time, which suggests local time, but the source does not confirm it.</li>
            <li><strong>Car park codes are unexplained.</strong> Names are shown as in the source. Some, such as NIA Car Parks and NIA South, may overlap, and the source does not say.</li>
          </ul>
        </section>

        <section className="card fade-in" aria-labelledby="not-title">
          <div className="card-head"><h2 id="not-title">What this dashboard does not do</h2></div>
          <ul className="clean note">
            <li>It does not connect to sensors or receive real-time data.</li>
            <li>It does not reserve spaces, take payment, or guarantee that a space is free.</li>
            <li>It does not provide navigation or a map.</li>
            <li>Model version {data.artifact_version} was trained offline. Nothing is trained or updated when you use this page.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
