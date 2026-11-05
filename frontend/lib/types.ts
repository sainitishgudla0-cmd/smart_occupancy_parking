export type ModelKey = "knn" | "svr" | "boosting";

export interface ZoneInfo {
  zone: string;
  capacity: number;
  cluster: number | null;
  last_observed: string | null;
}

export interface Meta {
  artifact_version: string;
  generated_at_utc: string;
  result_type: string;
  dataset: {
    name: string;
    creator: string;
    repository: string;
    url: string;
    doi: string;
    license: string;
    license_url: string;
    citation: string;
    changes: string;
    first_date: string;
    last_date: string;
    is_live: boolean;
  };
  quality: Record<string, unknown> & {
    raw_rows: number;
    raw_zones: number;
    exact_duplicate_rows_removed: number;
    negative_occupancy_rows_removed: number;
    rows_clipped_to_full: number;
    rows_outside_operating_grid_removed: number;
    rows_removed_multiple_readings_in_slot: number;
    stuck_sensor_readings_masked: number;
    within_day_collapse_readings_masked: number;
    isolated_spike_readings_masked: number;
    excluded_zones: { zone: string; observed_days: number; reason: string }[];
    calendar_dates_without_any_data: string[];
    clean_observations: number;
    grid_coverage_pct: number;
  };
  splits: Splits;
  horizon: { max_steps: number; slot_minutes: number; buckets: Bucket[] };
  default_model: ModelKey;
  models: Record<ModelKey, string>;
  zones: ZoneInfo[];
  latest_observed: string;
  replay: { first: string; last: string; days: string[]; slots: string[] };
}

export interface Bucket {
  id: string;
  label: string;
  min: number;
  max: number;
}

export interface Splits {
  unit: string;
  train: { first_date: string; last_date: string; rows: number };
  validation: { first_date: string; last_date: string; rows: number };
  test: { first_date: string; last_date: string; rows: number; days_scored: number };
}

export interface SnapshotZone {
  zone: string;
  capacity: number;
  rate: number | null;
  occupied: number | null;
  free: number | null;
  observed_at: string | null;
  current: boolean;
}

export interface Snapshot {
  as_of: string;
  is_latest: boolean;
  zones: SnapshotZone[];
  total: {
    rate: number | null;
    occupied: number;
    capacity: number;
    reporting_zones: number;
    all_zones: number;
  };
  source: string;
}

export interface ForecastValue {
  rate: number;
  lower: number;
  upper: number;
}

export interface Forecast {
  status: "ok" | "no_recent_reading";
  message?: string;
  zone: string;
  capacity: number;
  as_of: string;
  is_replay: boolean;
  last_observed: string | null;
  history: { time: string; rate: number | null }[];
  models: Partial<Record<ModelKey, ForecastValue[]>>;
  points: { time: string; horizon: number; crosses_overnight: boolean; actual: number | null }[];
}

export interface ZoneComparison {
  first_date: string | null;
  last_date: string | null;
  days_selected: number;
  slots: string[];
  near_full_threshold: number;
  zones: {
    zone: string;
    capacity: number;
    cluster: number | null;
    mean_rate: number | null;
    peak_rate: number | null;
    share_near_full: number | null;
    observations: number;
  }[];
  heatmap: { zone: string; cells: (number | null)[] }[];
}

export interface ClusterReport {
  method: string;
  data_window: string;
  features: Record<string, string>;
  silhouette_by_k: Record<string, number>;
  chosen_k: number;
  silhouette: number;
  stability_ari_mean: number;
  stability_ari_p10: number;
  stability_resamples: number;
  caveat: string;
  clusters: {
    id: number;
    label: string;
    zones: string[];
    size: number;
    center: Record<string, number>;
    profile: { time: string; rate: number }[];
  }[];
  zones: ({ zone: string; cluster: number; mean_rate: number; weekend_gap: number } & Record<string, unknown>)[];
}

export interface Score {
  mae_pct_points: number;
  rmse_pct_points: number;
  r2: number;
  n: number;
  mae_ci95?: [number, number];
  rmse_ci95?: [number, number];
}

export interface ModelEntry {
  label: string;
  best_params: Record<string, number | string>;
  tuning_rows: number;
  training_rows: number;
  training_rows_available: number;
  fit_seconds: number;
  batch_504_rows_ms: number;
  artifact_bytes: number;
  validation: Score;
  test: Score;
  test_by_horizon: Record<string, Score>;
  interval_half_width: Record<string, number>;
  interval_coverage_test: Record<string, number>;
}

export interface ModelReport {
  result_type: string;
  generated_at_utc: string;
  default_model: ModelKey;
  default_model_rule: string;
  comparisons_with_default: Record<
    string,
    { mae_difference_pct_points: number; ci95: [number, number]; distinguishable: boolean }
  >;
  interval_coverage_target: number;
  horizon_buckets: Bucket[];
  splits: Splits;
  models: Record<ModelKey, ModelEntry>;
  baselines: Record<string, { label: string; validation: Score; test: Score; test_by_horizon: Record<string, Score> }>;
  features: string[];
  reproducibility: Record<string, string | number>;
}
