"""Leakage-safe forecasting features.

This module is the single source of truth for feature construction. Both the
training scripts and the API import it, so training and serving cannot drift.

The time axis is a grid of *observed operating slots*: 18 half-hour slots per
calendar day (08:00 to 16:30). The source data has no readings outside that
window, so one horizon step means "the next slot in the operating window".
A step after 16:30 lands on 08:00 the next day, and the ``crosses_overnight``
feature tells the model when that has happened.

``rates`` is a 2-D array of shape (n_zones, n_days * SLOTS_PER_DAY) holding the
occupancy rate (occupied / capacity), with NaN wherever nothing was observed.

Every feature for an (origin, horizon) pair uses only values at or before the
origin. The lag columns that look back from the target time rely on the
restriction MAX_HORIZON <= SLOTS_PER_DAY, so "same slot on the previous day" is
never later than the origin.
"""

from __future__ import annotations

import numpy as np

SLOTS_PER_DAY = 18
FIRST_SLOT_MINUTES = 8 * 60
SLOT_MINUTES = 30
MAX_HORIZON = SLOTS_PER_DAY
SLOTS_PER_WEEK = SLOTS_PER_DAY * 7

FEATURE_NAMES = [
    "horizon_steps",
    "crosses_overnight",
    "target_slot_sin",
    "target_slot_cos",
    "target_dow_sin",
    "target_dow_cos",
    "target_is_weekend",
    "log_capacity",
    "rate_now",
    "rate_lag_1",
    "rate_lag_2",
    "delta_1",
    "rolling_mean_4",
    "same_slot_prev_day",
    "same_slot_prev_week",
    "history_mean_same_slot_daytype",
    "history_mean_zone",
    "now_minus_history_at_origin",
]


def _nan_mean(values: np.ndarray) -> float:
    finite = values[np.isfinite(values)]
    return float(finite.mean()) if finite.size else float("nan")


def history_tables(rates: np.ndarray, weekday_of_day: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Expanding means, indexed so that entry ``i`` uses only slots strictly before ``i``.

    Returns:
        zone_mean: (n_zones, n_slots + 1) mean of all prior observations for each zone.
        slot_mean: (n_zones, n_slots + 1, SLOTS_PER_DAY, 2) mean of prior observations by
            slot of day and day type (0 = weekday, 1 = weekend).
    """
    n_zones, n_slots = rates.shape
    zone_mean = np.full((n_zones, n_slots + 1), np.nan)
    slot_mean = np.full((n_zones, n_slots + 1, SLOTS_PER_DAY, 2), np.nan)
    for zone in range(n_zones):
        zone_sum = 0.0
        zone_count = 0
        sums = np.zeros((SLOTS_PER_DAY, 2))
        counts = np.zeros((SLOTS_PER_DAY, 2))
        for slot in range(n_slots):
            if zone_count:
                zone_mean[zone, slot] = zone_sum / zone_count
            with np.errstate(invalid="ignore", divide="ignore"):
                slot_mean[zone, slot] = np.where(counts > 0, sums / counts, np.nan)
            value = rates[zone, slot]
            if np.isfinite(value):
                zone_sum += value
                zone_count += 1
                slot_of_day = slot % SLOTS_PER_DAY
                day_type = int(weekday_of_day[slot // SLOTS_PER_DAY] >= 5)
                sums[slot_of_day, day_type] += value
                counts[slot_of_day, day_type] += 1
        if zone_count:
            zone_mean[zone, n_slots] = zone_sum / zone_count
        with np.errstate(invalid="ignore", divide="ignore"):
            slot_mean[zone, n_slots] = np.where(counts > 0, sums / counts, np.nan)
    return zone_mean, slot_mean


def weekday_for_slot(slot: int, weekday_of_day: np.ndarray, first_weekday: int) -> int:
    """Weekday of an absolute slot, including slots beyond the end of the data."""
    day = slot // SLOTS_PER_DAY
    if day < len(weekday_of_day):
        return int(weekday_of_day[day])
    return (first_weekday + day) % 7


def build_row(
    rates: np.ndarray,
    zone_mean: np.ndarray,
    slot_mean: np.ndarray,
    weekday_of_day: np.ndarray,
    capacity: np.ndarray,
    zone: int,
    origin: int,
    horizon: int,
) -> np.ndarray:
    """Build one feature row. Non-finite values remain NaN so callers can decide what to do."""
    if not 1 <= horizon <= MAX_HORIZON:
        raise ValueError(f"horizon must be in 1..{MAX_HORIZON}")
    series = rates[zone]
    target = origin + horizon
    target_slot = target % SLOTS_PER_DAY
    target_day = target // SLOTS_PER_DAY
    target_weekday = weekday_for_slot(target, weekday_of_day, int(weekday_of_day[0]))
    day_type = int(target_weekday >= 5)

    def at(index: int) -> float:
        return float(series[index]) if 0 <= index <= origin else float("nan")

    now = at(origin)
    lag_1 = at(origin - 1)
    lag_2 = at(origin - 2)
    # Same slot yesterday / last week relative to the *target*. For horizon == 18 the
    # previous-day value is the origin itself, which is known; it is never in the future.
    prev_day = at(target - SLOTS_PER_DAY)
    prev_week = at(target - SLOTS_PER_WEEK)
    rolling = _nan_mean(series[max(0, origin - 3) : origin + 1])

    # Tables at index ``origin + 1`` include the origin reading and nothing later.
    history_index = origin + 1
    profile = float(slot_mean[zone, history_index, target_slot, day_type])
    zone_avg = float(zone_mean[zone, history_index])
    origin_day_type = int(
        weekday_for_slot(origin, weekday_of_day, int(weekday_of_day[0])) >= 5
    )
    origin_profile = float(slot_mean[zone, history_index, origin % SLOTS_PER_DAY, origin_day_type])

    return np.array(
        [
            float(horizon),
            float(target_day != origin // SLOTS_PER_DAY),
            np.sin(2 * np.pi * target_slot / SLOTS_PER_DAY),
            np.cos(2 * np.pi * target_slot / SLOTS_PER_DAY),
            np.sin(2 * np.pi * target_weekday / 7),
            np.cos(2 * np.pi * target_weekday / 7),
            float(day_type),
            float(np.log(capacity[zone])),
            now,
            lag_1,
            lag_2,
            now - lag_1,
            rolling,
            prev_day,
            prev_week,
            profile,
            zone_avg,
            now - origin_profile,
        ]
    )


def impute_row(row: np.ndarray) -> np.ndarray:
    """Causal fallback chain for lags that are missing because of sensor gaps.

    Uses only other values in the same row, so it needs no fitted state and cannot leak.
    """
    index = {name: i for i, name in enumerate(FEATURE_NAMES)}
    out = row.copy()
    now = out[index["rate_now"]]
    zone_avg = out[index["history_mean_zone"]]
    profile = out[index["history_mean_same_slot_daytype"]]
    if not np.isfinite(profile):
        out[index["history_mean_same_slot_daytype"]] = profile = zone_avg
    if not np.isfinite(out[index["rate_lag_1"]]):
        out[index["rate_lag_1"]] = now
    if not np.isfinite(out[index["rate_lag_2"]]):
        out[index["rate_lag_2"]] = out[index["rate_lag_1"]]
    if not np.isfinite(out[index["delta_1"]]):
        out[index["delta_1"]] = 0.0
    if not np.isfinite(out[index["same_slot_prev_day"]]):
        out[index["same_slot_prev_day"]] = profile
    if not np.isfinite(out[index["same_slot_prev_week"]]):
        out[index["same_slot_prev_week"]] = profile
    if not np.isfinite(out[index["now_minus_history_at_origin"]]):
        out[index["now_minus_history_at_origin"]] = 0.0
    return out


def slot_to_label(slot_of_day: int) -> str:
    minutes = FIRST_SLOT_MINUTES + SLOT_MINUTES * slot_of_day
    return f"{minutes // 60:02d}:{minutes % 60:02d}"
