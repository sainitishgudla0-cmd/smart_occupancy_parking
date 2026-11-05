"""Read-only access to versioned artifacts. Never trains and never writes to disk."""

from __future__ import annotations

import json
import threading
from datetime import date, datetime, timedelta
from functools import cached_property
from pathlib import Path

import joblib
import numpy as np

from .features import (
    FEATURE_NAMES,
    MAX_HORIZON,
    SLOT_MINUTES,
    SLOTS_PER_DAY,
    build_row,
    history_tables,
    impute_row,
    slot_to_label,
)
from .intervals import bucket_for_horizon

ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "v1"
MODEL_NAMES = ("knn", "svr", "boosting")
# A reading older than this many slots (1 hour) is not used as a forecast origin.
STALE_LIMIT_SLOTS = 2
FULL_THRESHOLD = 0.95
MIN_REPORTABLE_SLOTS = 6


class InputError(ValueError):
    """The request was well formed but cannot be answered from this dataset."""


def _round(value: float, digits: int = 4) -> float | None:
    return round(float(value), digits) if np.isfinite(value) else None


class ParkingService:
    def __init__(self, artifact_dir: Path = ARTIFACT_DIR) -> None:
        self.artifact_dir = artifact_dir
        self._models: dict[str, object] = {}
        self._lock = threading.Lock()

    @cached_property
    def metadata(self) -> dict:
        return json.loads((self.artifact_dir / "metadata.json").read_text(encoding="utf-8"))

    @cached_property
    def _history(self) -> dict[str, np.ndarray]:
        with np.load(self.artifact_dir / "history.npz") as data:
            return {key: data[key] for key in data.files}

    @cached_property
    def rates(self) -> np.ndarray:
        return self._history["rates"].astype(np.float64)

    @cached_property
    def capacity(self) -> np.ndarray:
        return self._history["capacity"]

    @cached_property
    def zones(self) -> list[str]:
        return [str(z) for z in self._history["zones"]]

    @cached_property
    def dates(self) -> list[str]:
        return [str(d) for d in self._history["dates"]]

    @cached_property
    def weekday(self) -> np.ndarray:
        return self._history["weekday"]

    @cached_property
    def _tables(self) -> tuple[np.ndarray, np.ndarray]:
        return history_tables(self.rates, self.weekday)

    @cached_property
    def _zone_index(self) -> dict[str, int]:
        return {zone: i for i, zone in enumerate(self.zones)}

    @cached_property
    def _replay_first_slot(self) -> int:
        first = self.metadata["splits"]["test"]["first_date"]
        return self.dates.index(first) * SLOTS_PER_DAY

    @cached_property
    def _last_observed_slot(self) -> int:
        return int(np.flatnonzero(np.isfinite(self.rates).any(axis=0)).max())

    def model(self, name: str):
        if name not in MODEL_NAMES:
            raise InputError(f"Unknown model '{name}'.")
        with self._lock:
            if name not in self._models:
                self._models[name] = joblib.load(self.artifact_dir / f"{name}.joblib")
            return self._models[name]

    def slot_to_iso(self, slot: int) -> str:
        day = date.fromisoformat(self.dates[0]) + timedelta(days=slot // SLOTS_PER_DAY)
        return f"{day.isoformat()}T{slot_to_label(slot % SLOTS_PER_DAY)}"

    def parse_as_of(self, value: str | None) -> int:
        """Translate an as-of time to a slot. Only held-out test times may be replayed."""
        if value is None:
            return self._last_observed_slot
        try:
            moment = datetime.fromisoformat(value)
        except ValueError as error:
            raise InputError("as_of must look like 2016-12-12T10:30.") from error
        minutes = moment.hour * 60 + moment.minute
        slot_of_day = (minutes - 8 * 60) / SLOT_MINUTES
        if slot_of_day != int(slot_of_day) or not 0 <= slot_of_day < SLOTS_PER_DAY:
            raise InputError("as_of must fall on a half hour between 08:00 and 16:30.")
        day = (moment.date() - date.fromisoformat(self.dates[0])).days
        slot = day * SLOTS_PER_DAY + int(slot_of_day)
        if not self._replay_first_slot <= slot <= self._last_observed_slot:
            raise InputError(
                f"as_of must be within the held-out test period, "
                f"{self.slot_to_iso(self._replay_first_slot)} to "
                f"{self.slot_to_iso(self._last_observed_slot)}."
            )
        return slot

    def _resolve_zone(self, zone: str) -> int:
        if zone not in self._zone_index:
            raise KeyError(zone)
        return self._zone_index[zone]

    def _last_reading(self, zone: int, slot: int) -> int | None:
        finite = np.flatnonzero(np.isfinite(self.rates[zone, : slot + 1]))
        return int(finite[-1]) if finite.size else None

    def meta(self) -> dict:
        meta = self.metadata
        cluster_by_zone = {z["zone"]: z["cluster"] for z in meta["clusters"]["zones"]}
        zones = []
        for i, zone in enumerate(self.zones):
            last = self._last_reading(i, self.rates.shape[1] - 1)
            zones.append(
                {
                    "zone": zone,
                    "capacity": int(self.capacity[i]),
                    "cluster": cluster_by_zone.get(zone),
                    "last_observed": self.slot_to_iso(last) if last is not None else None,
                }
            )
        observed = np.isfinite(self.rates).any(axis=0)
        replay_days = sorted(
            {
                self.dates[s // SLOTS_PER_DAY]
                for s in np.flatnonzero(observed)
                if s >= self._replay_first_slot
            }
        )
        return {
            "artifact_version": meta["artifact_version"],
            "generated_at_utc": meta["generated_at_utc"],
            "result_type": meta["result_type"],
            "dataset": meta["dataset"],
            "quality": meta["quality"],
            "splits": meta["splits"],
            "horizon": meta["horizon"],
            "default_model": meta["default_model"],
            "models": {name: meta["models"][name]["label"] for name in MODEL_NAMES},
            "zones": zones,
            "latest_observed": self.slot_to_iso(self._last_observed_slot),
            "replay": {
                "first": self.slot_to_iso(self._replay_first_slot),
                "last": self.slot_to_iso(self._last_observed_slot),
                "days": replay_days,
                "slots": [slot_to_label(s) for s in range(SLOTS_PER_DAY)],
            },
        }

    def snapshot(self, as_of: str | None) -> dict:
        slot = self.parse_as_of(as_of)
        rows = []
        occupied_total = 0.0
        capacity_total = 0.0
        for i, zone in enumerate(self.zones):
            last = self._last_reading(i, slot)
            age = None if last is None else slot - last
            current = last is not None and age <= STALE_LIMIT_SLOTS
            rate = float(self.rates[i, last]) if last is not None else float("nan")
            if current:
                occupied_total += rate * self.capacity[i]
                capacity_total += self.capacity[i]
            rows.append(
                {
                    "zone": zone,
                    "capacity": int(self.capacity[i]),
                    "rate": _round(rate) if current else None,
                    "occupied": int(round(rate * self.capacity[i])) if current else None,
                    "free": int(round((1 - rate) * self.capacity[i])) if current else None,
                    "observed_at": self.slot_to_iso(last) if last is not None else None,
                    "current": bool(current),
                }
            )
        return {
            "as_of": self.slot_to_iso(slot),
            "is_latest": slot == self._last_observed_slot,
            "zones": rows,
            "total": {
                "rate": _round(occupied_total / capacity_total) if capacity_total else None,
                "occupied": int(round(occupied_total)),
                "capacity": int(capacity_total),
                "reporting_zones": sum(1 for r in rows if r["current"]),
                "all_zones": len(rows),
            },
            "source": self.metadata["dataset"]["name"],
        }

    def _rows_for(self, zone: int, origin: int, targets: list[int]) -> tuple[np.ndarray, list[int]]:
        zone_mean, slot_mean = self._tables
        rows = []
        horizons = []
        for target in targets:
            horizon = target - origin
            if horizon > MAX_HORIZON:
                continue
            row = build_row(
                self.rates, zone_mean, slot_mean, self.weekday, self.capacity, zone, origin, horizon
            )
            rows.append(impute_row(row))
            horizons.append(horizon)
        return (np.array(rows) if rows else np.empty((0, len(FEATURE_NAMES)))), horizons

    def forecast(self, zone_name: str, model_name: str, steps: int, as_of: str | None) -> dict:
        zone = self._resolve_zone(zone_name)
        if not 1 <= steps <= MAX_HORIZON:
            raise InputError(f"steps must be between 1 and {MAX_HORIZON}.")
        names = list(MODEL_NAMES) if model_name == "all" else [model_name]
        for name in names:
            if name not in MODEL_NAMES:
                raise InputError(f"Unknown model '{model_name}'.")

        slot = self.parse_as_of(as_of)
        last = self._last_reading(zone, slot)
        history_start = max(0, slot - SLOTS_PER_DAY * 2 + 1)
        history = [
            {"time": self.slot_to_iso(s), "rate": _round(self.rates[zone, s])}
            for s in range(history_start, slot + 1)
        ]
        response = {
            "zone": zone_name,
            "capacity": int(self.capacity[zone]),
            "as_of": self.slot_to_iso(slot),
            "is_replay": slot != self._last_observed_slot,
            "last_observed": self.slot_to_iso(last) if last is not None else None,
            "history": history,
            "models": {},
            "points": [],
        }
        if last is None or slot - last > STALE_LIMIT_SLOTS:
            response["status"] = "no_recent_reading"
            response["message"] = (
                f"{zone_name} has no reading in the hour before "
                f"{self.slot_to_iso(slot).replace('T', ' ')}, so no forecast is made."
            )
            return response

        targets = list(range(slot + 1, slot + steps + 1))
        X, horizons = self._rows_for(zone, last, targets)
        n_slots = self.rates.shape[1]
        kept_targets = targets[: len(horizons)]
        for name in names:
            predictions = np.clip(self.model(name).predict(X), 0, 1) if len(X) else np.array([])
            widths = self.metadata["models"][name]["interval_half_width"]
            response["models"][name] = [
                {
                    "rate": _round(p),
                    "lower": _round(max(0.0, p - widths[bucket_for_horizon(h)])),
                    "upper": _round(min(1.0, p + widths[bucket_for_horizon(h)])),
                }
                for p, h in zip(predictions, horizons)
            ]
        for target in kept_targets:
            actual = self.rates[zone, target] if target < n_slots else float("nan")
            response["points"].append(
                {
                    "time": self.slot_to_iso(target),
                    "horizon": target - slot,
                    "crosses_overnight": target // SLOTS_PER_DAY != slot // SLOTS_PER_DAY,
                    "actual": _round(actual),
                }
            )
        response["status"] = "ok"
        return response

    def zone_comparison(self, days: int | None, day_type: str) -> dict:
        """Summaries over the final ``days`` calendar days of data, or all of it."""
        grid = self.rates.reshape(len(self.zones), -1, SLOTS_PER_DAY)
        n_days = grid.shape[1]
        first = 0 if days is None else max(0, n_days - days)
        mask = np.zeros(n_days, dtype=bool)
        mask[first:] = True
        if day_type == "weekday":
            mask &= self.weekday < 5
        elif day_type == "weekend":
            mask &= self.weekday >= 5
        selected = grid[:, mask]
        cluster_by_zone = {z["zone"]: z["cluster"] for z in self.metadata["clusters"]["zones"]}

        rows = []
        heatmap = []
        for i, zone in enumerate(self.zones):
            values = selected[i]
            finite = values[np.isfinite(values)]
            enough = finite.size >= MIN_REPORTABLE_SLOTS
            rows.append(
                {
                    "zone": zone,
                    "capacity": int(self.capacity[i]),
                    "cluster": cluster_by_zone.get(zone),
                    "mean_rate": _round(finite.mean()) if enough else None,
                    "peak_rate": _round(np.percentile(finite, 90)) if enough else None,
                    "share_near_full": _round((finite >= FULL_THRESHOLD).mean()) if enough else None,
                    "observations": int(finite.size),
                }
            )
            cells = []
            for s in range(SLOTS_PER_DAY):
                column = values[:, s]
                column = column[np.isfinite(column)]
                cells.append(_round(column.mean()) if column.size else None)
            heatmap.append({"zone": zone, "cells": cells})
        included = np.flatnonzero(mask)
        return {
            "first_date": self.dates[int(included[0])] if included.size else None,
            "last_date": self.dates[int(included[-1])] if included.size else None,
            "days_selected": int(mask.sum()),
            "slots": [slot_to_label(s) for s in range(SLOTS_PER_DAY)],
            "zones": rows,
            "heatmap": heatmap,
            "near_full_threshold": FULL_THRESHOLD,
        }

    def clusters(self) -> dict:
        return self.metadata["clusters"]

    def model_report(self) -> dict:
        meta = self.metadata
        models = {}
        for name in MODEL_NAMES:
            entry = dict(meta["models"][name])
            entry.pop("tuning_trials", None)
            models[name] = entry
        return {
            "result_type": meta["result_type"],
            "generated_at_utc": meta["generated_at_utc"],
            "default_model": meta["default_model"],
            "default_model_rule": meta["default_model_rule"],
            "comparisons_with_default": meta["comparisons_with_default"],
            "interval_coverage_target": meta["interval_coverage_target"],
            "horizon_buckets": meta["horizon"]["buckets"],
            "splits": meta["splits"],
            "models": models,
            "baselines": meta["baselines"],
            "features": meta["features"],
            "reproducibility": meta["reproducibility"],
        }
