"use client";

import Link from "next/link";

import { AsOfPicker } from "@/components/Controls";
import { CountUp, StatTile } from "@/components/StatTile";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { query, useApi } from "@/lib/api";
import { formatDateTime, num, pct } from "@/lib/format";
import type { Meta, ModelReport, Snapshot } from "@/lib/types";
import { useFilters } from "@/lib/useFilters";

export default function OverviewPage() {
  const { get, setFilters } = useFilters();
  const asOf = get("as_of");
  const meta = useApi<Meta>("/api/meta");
  const snapshot = useApi<Snapshot>(query("/api/snapshot", { as_of: asOf }));
  const report = useApi<ModelReport>("/api/models");

  if (meta.error) return <ErrorState message={meta.error} onRetry={meta.retry} />;

  const snap = snapshot.data;
  const reporting = snap ? snap.zones.filter((z) => z.current && z.rate !== null) : [];
  const ranked = [...reporting].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const silent = snap ? snap.zones.filter((z) => !z.current) : [];
  const defaultModel = report.data ? report.data.models[report.data.default_model] : null;

  return (
    <>
      <header className="page-head">
        <h1>Occupancy overview</h1>
        <p>The state of each car park at the chosen time, from the source&apos;s half-hourly readings.</p>
      </header>

      {meta.data ? (
        <div className="filters">
          <AsOfPicker
            value={asOf}
            days={meta.data.replay.days}
            slots={meta.data.replay.slots}
            onChange={(value) => setFilters({ as_of: value })}
          />
        </div>
      ) : null}

      {snapshot.error ? <ErrorState message={snapshot.error} onRetry={snapshot.retry} /> : null}
      {!snap && !snapshot.error ? <Skeleton height={420} /> : null}

      {snap ? (
        <div className={`stack chart-wrap ${snapshot.loading ? "is-refreshing" : ""}`}>
          <div className="grid split-hero">
            <section className="card fade-in" aria-labelledby="hero-title">
              <h2 id="hero-title">{snap.is_latest ? "Latest observed occupancy" : "Observed occupancy at replay time"}</h2>
              <div className="hero-figure">
                <CountUp value={snap.total.rate} format={(v) => pct(v)} />
              </div>
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${(snap.total.rate ?? 0) * 100}%` }} />
              </div>
              <p className="note">
                {num(snap.total.occupied)} of {num(snap.total.capacity)} spaces occupied, across{" "}
                {snap.total.reporting_zones} of {snap.total.all_zones} car parks with a reading in the prior hour. Totals add up
                the source&apos;s entries, some of which may overlap.
              </p>
              <dl className="facts" style={{ marginTop: 14 }}>
                <dt>Observed</dt>
                <dd>{formatDateTime(snap.as_of)}</dd>
                <dt>Source</dt>
                <dd>
                  {meta.data ? (
                    <a href={meta.data.dataset.url} target="_blank" rel="noreferrer">
                      {meta.data.dataset.name}, {meta.data.dataset.repository}
                    </a>
                  ) : (
                    snap.source
                  )}
                </dd>
              </dl>
            </section>

            <div className="grid grid-tiles-2">
              <StatTile
                label="Free spaces"
                value={<CountUp value={snap.total.capacity - snap.total.occupied} format={(v) => num(Math.round(v))} />}
                sub="Capacity minus reported occupancy"
              />
              <StatTile
                label="Fullest car park"
                value={ranked[0]?.zone ?? "n/a"}
                sub={ranked[0] ? `${pct(ranked[0].rate)} of ${num(ranked[0].capacity)} spaces` : undefined}
              />
              <StatTile
                label="Most available"
                value={ranked[ranked.length - 1]?.zone ?? "n/a"}
                sub={
                  ranked.length
                    ? `${pct(ranked[ranked.length - 1].rate)} of ${num(ranked[ranked.length - 1].capacity)} spaces`
                    : undefined
                }
              />
              {defaultModel ? (
                <StatTile
                  label="Typical forecast error"
                  value={
                    <>
                      <CountUp value={defaultModel.test.mae_pct_points} format={(v) => v.toFixed(1)} />
                      <span style={{ fontSize: "1rem", fontWeight: 560 }}> pts</span>
                    </>
                  }
                  sub={
                    <>
                      Measured test MAE of {defaultModel.label}, in percentage points of capacity.{" "}
                      <Link href="/models">Compare models</Link>
                    </>
                  }
                />
              ) : null}
            </div>
          </div>

          <section className="card fade-in" aria-labelledby="rank-title">
            <div className="card-head">
              <h2 id="rank-title">Occupancy by car park</h2>
              <p>Percent of capacity at {formatDateTime(snap.as_of)}. Names are the source&apos;s identifiers. Select one to see its forecast.</p>
            </div>
            {ranked.length === 0 ? (
              <EmptyState title="No readings at this time">
                No car park reported in the hour before this time. Try another replay time.
              </EmptyState>
            ) : (
              <div className="bars">
                {ranked.map((zone) => (
                  <Link
                    key={zone.zone}
                    className="bar-row"
                    href={query("/forecast", { zone: zone.zone, as_of: asOf })}
                    aria-label={`${zone.zone}: ${pct(zone.rate)} occupied, ${num(zone.free)} of ${num(zone.capacity)} spaces free. View forecast.`}
                  >
                    <span className="bar-name" title={zone.zone}>{zone.zone}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(zone.rate ?? 0) * 100}%` }} />
                    </span>
                    <span className="bar-value">{pct(zone.rate)}</span>
                  </Link>
                ))}
              </div>
            )}
            {silent.length ? (
              <p className="small" style={{ marginTop: 12 }}>
                Not shown, no reading in the prior hour:{" "}
                {silent
                  .map((z) => `${z.zone}${z.observed_at ? ` (last ${formatDateTime(z.observed_at)})` : ""}`)
                  .join("; ")}
                .
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
