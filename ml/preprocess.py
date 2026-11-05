"""Clean raw readings and place them on a regular grid of half-hour operating slots.

Output: data/processed/grid.npz and data/processed/quality_report.json
Nothing here looks at model performance. Every rule judges a reading only from its
own value or its immediate neighbours.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

import config
from parking_core.features import FIRST_SLOT_MINUTES, SLOT_MINUTES, SLOTS_PER_DAY


def load_raw() -> pd.DataFrame:
    frame = pd.read_csv(config.RAW_CSV)
    frame["timestamp"] = pd.to_datetime(frame["LastUpdated"], format="%Y-%m-%d %H:%M:%S")
    return frame.rename(
        columns={"SystemCodeNumber": "zone", "Capacity": "capacity", "Occupancy": "occupancy"}
    )[["zone", "capacity", "occupancy", "timestamp"]]


def snap_to_slots(frame: pd.DataFrame) -> pd.DataFrame:
    """Round each reading to the nearest half hour and record how far it moved."""
    out = frame.copy()
    stamp = out["timestamp"].dt
    minutes = stamp.hour * 60 + stamp.minute + stamp.second / 60
    out["slot"] = np.round((minutes - FIRST_SLOT_MINUTES) / SLOT_MINUTES).astype(int)
    out["offset"] = (minutes - (FIRST_SLOT_MINUTES + out["slot"] * SLOT_MINUTES)).abs()
    out["date"] = stamp.normalize()
    return out


def mask_spikes(values: np.ndarray, threshold: float) -> np.ndarray:
    """Flag isolated readings far from both neighbours while the neighbours agree.

    A reading that jumps by more than the threshold for a single slot and then
    returns is treated as a sensor dropout rather than demand.
    """
    flagged = np.zeros(values.shape, dtype=bool)
    for i in range(1, len(values) - 1):
        before, here, after = values[i - 1], values[i], values[i + 1]
        if not (np.isfinite(before) and np.isfinite(here) and np.isfinite(after)):
            continue
        if (
            abs(here - before) > threshold
            and abs(here - after) > threshold
            and abs(before - after) < threshold / 2
        ):
            flagged[i] = True
    return flagged


def mask_stuck_runs(values: np.ndarray, min_run: int) -> np.ndarray:
    """Flag runs of identical non-full readings long enough to suggest a frozen feed."""
    flagged = np.zeros(values.shape, dtype=bool)
    start = 0
    for i in range(1, len(values) + 1):
        if i == len(values) or values[i] != values[start]:
            run_is_long = i - start >= min_run
            if run_is_long and np.isfinite(values[start]) and values[start] < 1.0:
                flagged[start:i] = True
            start = i
    return flagged


def mask_collapses(values: np.ndarray, threshold: float) -> np.ndarray:
    """Flag the rest of the day after an implausible single-slot fall within that day.

    Overnight falls are normal, so only steps inside one operating day are considered.
    """
    flagged = np.zeros(values.shape, dtype=bool)
    for day_start in range(0, len(values), SLOTS_PER_DAY):
        day = values[day_start : day_start + SLOTS_PER_DAY]
        for slot in range(len(day) - 1):
            if np.isfinite(day[slot]) and np.isfinite(day[slot + 1]):
                if day[slot] - day[slot + 1] > threshold:
                    flagged[day_start + slot + 1 : day_start + len(day)] = True
                    break
    return flagged


def main() -> None:
    raw = load_raw()
    report: dict = {
        "raw_rows": int(len(raw)),
        "raw_zones": int(raw["zone"].nunique()),
        "raw_first_timestamp": str(raw["timestamp"].min()),
        "raw_last_timestamp": str(raw["timestamp"].max()),
        "missing_values_by_column": {k: int(v) for k, v in raw.isna().sum().items()},
    }

    before = len(raw)
    frame = raw.drop_duplicates()
    report["exact_duplicate_rows_removed"] = before - len(frame)

    negative = frame["occupancy"] < 0
    report["negative_occupancy_rows_removed"] = int(negative.sum())
    frame = frame[~negative]

    ratio = frame["occupancy"] / frame["capacity"]
    too_high = ratio > config.MAX_OVER_CAPACITY_RATIO
    report["rows_removed_above_110pct_capacity"] = int(too_high.sum())
    frame = frame[~too_high].copy()
    report["rows_clipped_to_full"] = int((frame["occupancy"] > frame["capacity"]).sum())
    frame["rate"] = (frame["occupancy"] / frame["capacity"]).clip(upper=1.0)

    frame = snap_to_slots(frame)
    outside = ~frame["slot"].between(0, SLOTS_PER_DAY - 1)
    report["rows_outside_operating_grid_removed"] = int(outside.sum())
    frame = frame[~outside]
    report["max_snap_offset_minutes"] = round(float(frame["offset"].max()), 2)

    before = len(frame)
    frame = frame.sort_values(["zone", "date", "slot", "offset", "timestamp"]).drop_duplicates(
        ["zone", "date", "slot"], keep="first"
    )
    report["rows_removed_multiple_readings_in_slot"] = before - len(frame)

    capacities = frame.groupby("zone")["capacity"].agg(["min", "max"])
    report["zones_with_changing_capacity"] = capacities[
        capacities["min"] != capacities["max"]
    ].index.tolist()

    observed_days = frame.groupby("zone")["date"].nunique().sort_index()
    excluded = observed_days[observed_days < config.MIN_OBSERVED_DAYS]
    report["excluded_zones"] = [
        {
            "zone": zone,
            "observed_days": int(days),
            "reason": f"Fewer than {config.MIN_OBSERVED_DAYS} observed days",
        }
        for zone, days in excluded.items()
    ]
    frame = frame[~frame["zone"].isin(excluded.index)]

    zones = sorted(frame["zone"].unique())
    days = pd.date_range(frame["date"].min(), frame["date"].max(), freq="D")
    rates = np.full((len(zones), len(days) * SLOTS_PER_DAY), np.nan)
    capacity = np.zeros(len(zones))
    zone_index = {zone: i for i, zone in enumerate(zones)}
    day_index = {day: i for i, day in enumerate(days)}
    for row in frame.itertuples(index=False):
        rates[zone_index[row.zone], day_index[row.date] * SLOTS_PER_DAY + row.slot] = row.rate
        capacity[zone_index[row.zone]] = row.capacity

    spikes = 0
    stuck = 0
    collapsed = 0
    per_zone_masked: dict[str, dict[str, int]] = {}
    for i, zone in enumerate(zones):
        series = rates[i]
        finite = np.isfinite(series)
        spike_mask = mask_spikes(series, config.SPIKE_THRESHOLD)
        stuck_mask = mask_stuck_runs(series, config.STUCK_RUN_SLOTS)
        collapse_mask = mask_collapses(series, config.COLLAPSE_THRESHOLD)
        spikes += int(spike_mask.sum())
        stuck += int((stuck_mask & ~spike_mask).sum())
        collapsed += int((collapse_mask & finite & ~spike_mask & ~stuck_mask).sum())
        combined = spike_mask | stuck_mask | collapse_mask
        if (combined & finite).any():
            per_zone_masked[zone] = {
                "spikes": int(spike_mask.sum()),
                "stuck": int(stuck_mask.sum()),
                "collapse": int((collapse_mask & finite).sum()),
            }
        series[combined] = np.nan
    report["isolated_spike_readings_masked"] = spikes
    report["stuck_sensor_readings_masked"] = stuck
    report["within_day_collapse_readings_masked"] = collapsed
    report["masked_by_zone"] = per_zone_masked

    by_day = np.isfinite(rates).reshape(len(zones), len(days), SLOTS_PER_DAY)
    observed_per_day = by_day.any(axis=(0, 2))
    report["calendar_dates_without_any_data"] = [
        str(days[i].date()) for i in np.flatnonzero(~observed_per_day)
    ]
    report["clean_observations"] = int(np.isfinite(rates).sum())
    report["grid_cells"] = int(rates.size)
    report["grid_coverage_pct"] = round(100 * float(np.isfinite(rates).mean()), 1)
    report["modelled_zones"] = len(zones)

    # Look for a clock shift at the end of British Summer Time (2016-10-30). A shift
    # here would mean slot labels do not line up across the period.
    stamped = raw.assign(date=raw["timestamp"].dt.normalize())
    first = stamped.groupby(["zone", "date"])["timestamp"].min()
    first_minutes = first.dt.hour * 60 + first.dt.minute
    dates = first.index.get_level_values("date")
    report["median_first_reading_minutes_before_bst_end"] = float(
        first_minutes[dates < "2016-10-30"].median()
    )
    report["median_first_reading_minutes_after_bst_end"] = float(
        first_minutes[dates > "2016-10-30"].median()
    )

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        config.PROCESSED_GRID,
        rates=rates,
        capacity=capacity,
        zones=np.array(zones),
        dates=np.array([str(d.date()) for d in days]),
        weekday=np.array([d.weekday() for d in days]),
    )
    config.QUALITY_REPORT.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
