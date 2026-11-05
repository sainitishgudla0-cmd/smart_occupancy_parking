"""Cluster car parks by demand pattern, using only data from before the test period."""

from __future__ import annotations

import warnings

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import StandardScaler

import config  # noqa: F401  (puts backend/ on the import path)
from parking_core.features import SLOTS_PER_DAY, slot_to_label

CLUSTER_FEATURES = {
    "mean_rate": "Average occupancy across all observed slots",
    "peak_rate": "90th percentile of occupancy",
    "weekend_gap": "Weekend average minus weekday average",
    "morning_rise": "Average occupancy at 11:00 minus average at 08:00",
    "afternoon_fall": "Average occupancy at 13:00 minus average at 16:30",
    "day_to_day_variation": "Standard deviation of daily average occupancy",
}
K_RANGE = range(2, 7)
SLOT_0800 = 0
SLOT_1100 = 6
SLOT_1300 = 10
SLOT_1630 = 17


def zone_features(day_grid: np.ndarray, weekday: np.ndarray) -> np.ndarray:
    """day_grid has shape (zones, days, slots). Returns (zones, len(CLUSTER_FEATURES))."""
    rows = []
    for zone_days in day_grid:
        weekend = weekday >= 5
        profile = np.nanmean(zone_days, axis=0)
        observed_days = np.isfinite(zone_days).any(axis=1)
        daily = np.nanmean(zone_days[observed_days], axis=1)
        rows.append(
            [
                np.nanmean(zone_days),
                np.nanpercentile(zone_days, 90),
                np.nanmean(zone_days[weekend]) - np.nanmean(zone_days[~weekend]),
                profile[SLOT_1100] - profile[SLOT_0800],
                profile[SLOT_1300] - profile[SLOT_1630],
                np.nanstd(daily),
            ]
        )
    return np.array(rows)


def fit_kmeans(features: np.ndarray, k: int, seed: int) -> np.ndarray:
    return KMeans(n_clusters=k, n_init=50, random_state=seed).fit_predict(features)


def describe(center: dict[str, float], medians: dict[str, float]) -> str:
    """Plain-language label from measured values, relative to the other car parks."""
    difference = center["mean_rate"] - medians["mean_rate"]
    if difference >= 0.08:
        level = "Higher average occupancy"
    elif difference <= -0.08:
        level = "Lower average occupancy"
    else:
        level = "Mid-range average occupancy"
    gap = center["weekend_gap"]
    if gap >= 0.05:
        week = "fuller at weekends"
    elif gap <= -0.05:
        week = "quieter at weekends"
    else:
        week = "similar across the week"
    return f"{level}, {week}"


def cluster(
    rates: np.ndarray,
    zones: np.ndarray,
    dates: np.ndarray,
    weekday: np.ndarray,
    end_day: int,
    seed: int,
) -> dict:
    """end_day is the exclusive day index where the test period begins."""
    day_grid = rates.reshape(len(zones), -1, SLOTS_PER_DAY)[:, :end_day]
    usable_days = np.isfinite(day_grid).any(axis=(0, 2))
    day_grid = day_grid[:, usable_days]
    days_weekday = weekday[:end_day][usable_days]

    raw = zone_features(day_grid, days_weekday)
    scaler = StandardScaler().fit(raw)
    scaled = scaler.transform(raw)

    scores = {}
    for k in K_RANGE:
        scores[k] = float(silhouette_score(scaled, fit_kmeans(scaled, k, seed)))
    best_k = max(scores, key=scores.get)
    labels = fit_kmeans(scaled, best_k, seed)

    # Stability: re-cluster on days resampled with replacement and compare assignments.
    rng = np.random.default_rng(seed)
    agreements = []
    n_days = day_grid.shape[1]
    for _ in range(200):
        picks = rng.integers(0, n_days, n_days)
        sample_weekday = days_weekday[picks]
        if (sample_weekday >= 5).sum() == 0 or (sample_weekday < 5).sum() == 0:
            continue
        # A resample can miss every observed day of a partly covered zone. Skip those draws.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            sample = zone_features(day_grid[:, picks], sample_weekday)
        if not np.isfinite(sample).all():
            continue
        sample_scaled = StandardScaler().fit_transform(sample)
        resampled = KMeans(n_clusters=best_k, n_init=10, random_state=seed).fit_predict(sample_scaled)
        agreements.append(adjusted_rand_score(labels, resampled))

    names = list(CLUSTER_FEATURES)
    medians = {name: float(np.median(raw[:, i])) for i, name in enumerate(names)}
    order = np.argsort([-raw[labels == c, 0].mean() for c in range(best_k)])
    clusters = []
    assignment = {}
    for new_id, old_id in enumerate(order):
        members = labels == old_id
        center = {name: float(raw[members, i].mean()) for i, name in enumerate(names)}
        member_zones = [str(z) for z in zones[members]]
        profile = np.nanmean(day_grid[members], axis=(0, 1))
        clusters.append(
            {
                "id": int(new_id),
                "label": describe(center, medians),
                "zones": member_zones,
                "size": int(members.sum()),
                "center": {k: round(v, 4) for k, v in center.items()},
                "profile": [
                    {"time": slot_to_label(s), "rate": round(float(profile[s]), 4)}
                    for s in range(SLOTS_PER_DAY)
                ],
            }
        )
        for zone in member_zones:
            assignment[zone] = int(new_id)

    # Make any identical labels distinguishable by the measured morning rise.
    seen: dict[str, int] = {}
    for entry in clusters:
        seen[entry["label"]] = seen.get(entry["label"], 0) + 1
    for entry in clusters:
        if seen[entry["label"]] > 1:
            rise = entry["center"]["morning_rise"]
            entry["label"] += f", morning rise {round(rise * 100)} pts"

    zone_points = [
        {
            "zone": str(zones[i]),
            "cluster": assignment[str(zones[i])],
            **{name: round(float(raw[i, j]), 4) for j, name in enumerate(names)},
        }
        for i in range(len(zones))
    ]
    return {
        "method": "K-means on standardized features",
        "data_window": f"{dates[0]} to {dates[end_day - 1]} (excludes the test period)",
        "features": CLUSTER_FEATURES,
        "silhouette_by_k": {str(k): round(v, 4) for k, v in scores.items()},
        "chosen_k": int(best_k),
        "silhouette": round(scores[best_k], 4),
        "stability_ari_mean": round(float(np.mean(agreements)), 4),
        "stability_ari_p10": round(float(np.percentile(agreements, 10)), 4),
        "stability_resamples": len(agreements),
        "clusters": clusters,
        "zones": zone_points,
        "caveat": (
            "Labels describe measured occupancy patterns only. The dataset does not state "
            "what a car park is used for, so no land-use or purpose is implied."
        ),
    }
