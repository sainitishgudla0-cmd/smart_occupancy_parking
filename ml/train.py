"""Train and compare forecasting models, then write versioned artifacts for the API.

Tuning and model choice use validation data only. The test period is scored after the
final models are chosen, and no decision in this script reads its results.
"""

from __future__ import annotations

import hashlib
import json
import platform
import time
from datetime import datetime, timezone
from itertools import product

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from sklearn.neighbors import KNeighborsRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR

import config  # noqa: I001  (must come first: it puts backend/ on the import path)
import cluster_zones
from parking_core.features import (
    FEATURE_NAMES,
    MAX_HORIZON,
    SLOTS_PER_DAY,
    build_row,
    history_tables,
    impute_row,
)
from parking_core.intervals import HORIZON_BUCKETS, bucket_for_horizon

INTERVAL_COVERAGE = 0.80
KNN_TRAIN_ROWS = 40_000
SVR_TUNE_ROWS = 5_000
SVR_TRAIN_ROWS = 12_000
BOOSTING_TUNE_ROWS = 80_000
TUNE_EVAL_ROWS = 25_000
INTERVAL_ROWS = 40_000
BOOTSTRAP_RESAMPLES = 2_000

MODEL_LABELS = {"knn": "KNN regression", "svr": "Support Vector Regression", "boosting": "HistGradientBoosting"}

GRIDS = {
    "knn": [
        {"n_neighbors": k, "weights": w}
        for k, w in product([2, 3, 5, 10, 25, 50, 100], ["uniform", "distance"])
    ],
    "svr": [
        {"C": c, "gamma": g, "epsilon": e}
        for c, g, e in product([0.1, 0.3, 1.0, 5.0], [0.002, 0.005, 0.01, 0.02, 0.05], [0.005, 0.02, 0.05])
    ],
    "boosting": [
        {"learning_rate": lr, "max_leaf_nodes": n, "min_samples_leaf": m, "max_iter": it}
        for lr, n, m, it in product([0.02, 0.05, 0.1], [15, 31, 63], [5, 20, 100], [400, 1000])
    ],
}


def make_model(name: str, params: dict):
    if name == "knn":
        return make_pipeline(StandardScaler(), KNeighborsRegressor(algorithm="kd_tree", **params))
    if name == "svr":
        return make_pipeline(StandardScaler(), SVR(kernel="rbf", cache_size=1000, **params))
    return HistGradientBoostingRegressor(early_stopping=False, random_state=config.SEED, **params)


def predict(model, X: np.ndarray) -> np.ndarray:
    return np.clip(model.predict(X), 0.0, 1.0)


def build_dataset(rates, capacity, weekday, zone_mean, slot_mean, first_day, last_day):
    """All (zone, origin, horizon) rows whose origin and target both lie in [first_day, last_day]."""
    first_slot = first_day * SLOTS_PER_DAY
    end_slot = (last_day + 1) * SLOTS_PER_DAY
    X, y, meta = [], [], []
    for zone in range(rates.shape[0]):
        series = rates[zone]
        for origin in range(first_slot, end_slot):
            if not np.isfinite(series[origin]):
                continue
            for horizon in range(1, MAX_HORIZON + 1):
                target = origin + horizon
                if target >= end_slot or not np.isfinite(series[target]):
                    continue
                row = build_row(rates, zone_mean, slot_mean, weekday, capacity, zone, origin, horizon)
                X.append(impute_row(row))
                y.append(series[target])
                meta.append((zone, origin // SLOTS_PER_DAY, horizon))
    return np.array(X), np.array(y), np.array(meta, dtype=np.int32)


def sample(rng: np.random.Generator, n: int, size: int) -> np.ndarray:
    return np.arange(n) if n <= size else np.sort(rng.choice(n, size, replace=False))


def score(y: np.ndarray, pred: np.ndarray) -> dict:
    return {
        "mae_pct_points": round(100 * float(mean_absolute_error(y, pred)), 3),
        "rmse_pct_points": round(100 * float(root_mean_squared_error(y, pred)), 3),
        "r2": round(float(r2_score(y, pred)), 4),
        "n": int(len(y)),
    }


def bootstrap_ci(y, pred, days, seed) -> dict:
    """95% interval from resampling whole test days, since rows within a day are correlated."""
    rng = np.random.default_rng(seed)
    unique = np.unique(days)
    errors = y - pred
    sums = {d: (np.abs(errors[days == d]).sum(), (errors[days == d] ** 2).sum(), int((days == d).sum())) for d in unique}
    table = np.array([sums[d] for d in unique])
    picks = rng.integers(0, len(unique), (BOOTSTRAP_RESAMPLES, len(unique)))
    drawn = table[picks]
    counts = drawn[:, :, 2].sum(axis=1)
    mae = 100 * drawn[:, :, 0].sum(axis=1) / counts
    rmse = 100 * np.sqrt(drawn[:, :, 1].sum(axis=1) / counts)
    return {
        "mae_ci95": [round(float(np.percentile(mae, 2.5)), 3), round(float(np.percentile(mae, 97.5)), 3)],
        "rmse_ci95": [round(float(np.percentile(rmse, 2.5)), 3), round(float(np.percentile(rmse, 97.5)), 3)],
    }


def paired_mae_difference(y, reference, other, days, seed) -> dict:
    """MAE of ``other`` minus ``reference``, resampling the same test days for both models.

    Above zero means ``reference`` is better. An interval that includes zero means this
    test period cannot separate the two.
    """
    rng = np.random.default_rng(seed)
    unique = np.unique(days)
    a = np.array([np.abs(y[days == d] - reference[days == d]).sum() for d in unique])
    b = np.array([np.abs(y[days == d] - other[days == d]).sum() for d in unique])
    n = np.array([(days == d).sum() for d in unique])
    picks = rng.integers(0, len(unique), (BOOTSTRAP_RESAMPLES, len(unique)))
    difference = 100 * (b[picks].sum(axis=1) - a[picks].sum(axis=1)) / n[picks].sum(axis=1)
    low, high = np.percentile(difference, [2.5, 97.5])
    return {
        "mae_difference_pct_points": round(float(100 * (b.sum() - a.sum()) / n.sum()), 3),
        "ci95": [round(float(low), 3), round(float(high), 3)],
        "distinguishable": bool(low > 0 or high < 0),
    }


def by_bucket(y, pred, horizons) -> dict:
    out = {}
    for bucket in HORIZON_BUCKETS:
        mask = (horizons >= bucket["min"]) & (horizons <= bucket["max"])
        out[bucket["id"]] = score(y[mask], pred[mask])
    return out


def conformal_widths(y, pred, horizons) -> dict:
    """Split-conformal half-width per horizon bucket, from out-of-sample residuals."""
    widths = {}
    for bucket in HORIZON_BUCKETS:
        mask = (horizons >= bucket["min"]) & (horizons <= bucket["max"])
        residuals = np.abs(y[mask] - pred[mask])
        n = residuals.size
        level = min(1.0, np.ceil((n + 1) * INTERVAL_COVERAGE) / n)
        widths[bucket["id"]] = round(float(np.quantile(residuals, level)), 4)
    return widths


def coverage(y, pred, horizons, widths) -> dict:
    half = np.array([widths[bucket_for_horizon(int(h))] for h in horizons])
    inside = (y >= np.clip(pred - half, 0, 1)) & (y <= np.clip(pred + half, 0, 1))
    out = {"overall": round(float(inside.mean()), 4)}
    for bucket in HORIZON_BUCKETS:
        mask = (horizons >= bucket["min"]) & (horizons <= bucket["max"])
        out[bucket["id"]] = round(float(inside[mask].mean()), 4)
    return out


def sha256(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    started = time.perf_counter()
    grid = np.load(config.PROCESSED_GRID)
    rates = grid["rates"]
    capacity = grid["capacity"]
    zones = grid["zones"]
    dates = grid["dates"]
    weekday = grid["weekday"]
    day_of = {str(d): i for i, d in enumerate(dates)}
    train_end = day_of[config.TRAIN_END]
    val_start = day_of[config.VALIDATION_START]
    val_end = day_of[config.VALIDATION_END]
    test_start = day_of[config.TEST_START]
    last_day = len(dates) - 1

    zone_mean, slot_mean = history_tables(rates, weekday)
    print("Building feature rows...")
    args = (rates, capacity, weekday, zone_mean, slot_mean)
    X_train, y_train, m_train = build_dataset(*args, config.MIN_HISTORY_DAYS, train_end)
    X_val, y_val, m_val = build_dataset(*args, val_start, val_end)
    X_test, y_test, m_test = build_dataset(*args, test_start, last_day)
    print(f"rows train={len(y_train):,} val={len(y_val):,} test={len(y_test):,}")
    for name, X in [("train", X_train), ("val", X_val), ("test", X_test)]:
        if not np.isfinite(X).all():
            raise SystemExit(f"Non-finite features in {name}: impute_row should have handled them.")

    rng = np.random.default_rng(config.SEED)
    eval_idx = sample(rng, len(y_val), TUNE_EVAL_ROWS)
    knn_idx = sample(rng, len(y_train), KNN_TRAIN_ROWS)
    svr_tune_idx = sample(rng, len(y_train), SVR_TUNE_ROWS)
    svr_idx = sample(rng, len(y_train), SVR_TRAIN_ROWS)
    boosting_tune_idx = sample(rng, len(y_train), BOOSTING_TUNE_ROWS)
    tune_rows = {"knn": knn_idx, "svr": svr_tune_idx, "boosting": boosting_tune_idx}
    final_rows = {"knn": knn_idx, "svr": svr_idx, "boosting": np.arange(len(y_train))}

    X_refit = np.vstack([X_train, X_val])
    y_refit = np.concatenate([y_train, y_val])
    refit_size = {"knn": KNN_TRAIN_ROWS, "svr": SVR_TRAIN_ROWS, "boosting": len(y_refit)}

    interval_idx = sample(rng, len(y_val), INTERVAL_ROWS)
    results: dict[str, dict] = {}
    test_predictions: dict[str, np.ndarray] = {}
    config.ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    for name in ("knn", "svr", "boosting"):
        print(f"\nTuning {name} over {len(GRIDS[name])} settings on validation data")
        best = None
        trials = []
        rows = tune_rows[name]
        for params in GRIDS[name]:
            model = make_model(name, params).fit(X_train[rows], y_train[rows])
            pred = predict(model, X_val[eval_idx])
            rmse = 100 * float(root_mean_squared_error(y_val[eval_idx], pred))
            trials.append({"params": params, "validation_rmse_pct_points": round(rmse, 3)})
            if best is None or rmse < best[0]:
                best = (rmse, params)
        best_params = best[1]
        print(f"  best {best_params} (tuning RMSE {best[0]:.2f})")

        # Train-only fit: honest validation score and residuals for the prediction bands.
        rows = final_rows[name]
        model = make_model(name, best_params).fit(X_train[rows], y_train[rows])
        val_pred = predict(model, X_val[interval_idx])
        validation = score(y_val[interval_idx], val_pred)
        widths = conformal_widths(y_val[interval_idx], val_pred, m_val[interval_idx, 2])

        # Final fit on train + validation. Its rows all have targets before the test period.
        refit_idx = sample(rng, len(y_refit), refit_size[name])
        began = time.perf_counter()
        final = make_model(name, best_params).fit(X_refit[refit_idx], y_refit[refit_idx])
        fit_seconds = time.perf_counter() - began

        began = time.perf_counter()
        pred = predict(final, X_test)
        predict_seconds = time.perf_counter() - began
        test_predictions[name] = pred
        print(f"  test {score(y_test, pred)}")

        path = config.ARTIFACT_DIR / f"{name}.joblib"
        joblib.dump(final, path, compress=3)

        batch = X_test[:504]
        began = time.perf_counter()
        predict(final, batch)
        batch_ms = 1000 * (time.perf_counter() - began)

        results[name] = {
            "label": MODEL_LABELS[name],
            "best_params": best_params,
            "tuning_trials": trials,
            "tuning_rows": int(len(tune_rows[name])),
            "training_rows": int(len(refit_idx)),
            "training_rows_available": int(len(y_refit)),
            "fit_seconds": round(fit_seconds, 2),
            "test_predict_seconds": round(predict_seconds, 2),
            "batch_504_rows_ms": round(batch_ms, 1),
            "artifact_bytes": path.stat().st_size,
            "artifact_sha256": sha256(path),
            "validation": validation,
            "test": {**score(y_test, pred), **bootstrap_ci(y_test, pred, m_test[:, 1], config.SEED)},
            "test_by_horizon": by_bucket(y_test, pred, m_test[:, 2]),
            "interval_half_width": widths,
            "interval_coverage_test": coverage(y_test, pred, m_test[:, 2], widths),
            "test_by_zone": {
                str(zones[z]): {
                    "mae_pct_points": round(
                        100 * float(np.abs(y_test[m_test[:, 0] == z] - pred[m_test[:, 0] == z]).mean()), 3
                    ),
                    "mae_spaces": round(
                        float(capacity[z] * np.abs(y_test[m_test[:, 0] == z] - pred[m_test[:, 0] == z]).mean()), 1
                    ),
                }
                for z in np.unique(m_test[:, 0])
            },
        }

    names = FEATURE_NAMES
    baseline_columns = {
        "persistence": ("Persistence (latest reading carried forward)", names.index("rate_now")),
        "seasonal_profile": (
            "Historical average for the same slot and day type",
            names.index("history_mean_same_slot_daytype"),
        ),
    }
    baselines = {}
    for key, (label, column) in baseline_columns.items():
        val_pred = np.clip(X_val[interval_idx, column], 0, 1)
        pred = np.clip(X_test[:, column], 0, 1)
        baselines[key] = {
            "label": label,
            "validation": score(y_val[interval_idx], val_pred),
            "test": {**score(y_test, pred), **bootstrap_ci(y_test, pred, m_test[:, 1], config.SEED)},
            "test_by_horizon": by_bucket(y_test, pred, m_test[:, 2]),
        }
        test_predictions[key] = pred

    default_model = min(results, key=lambda n: results[n]["validation"]["rmse_pct_points"])
    print(f"\nDefault model, chosen by validation RMSE: {default_model}")

    comparisons = {
        other: paired_mae_difference(
            y_test, test_predictions[default_model], test_predictions[other], m_test[:, 1], config.SEED
        )
        for other in test_predictions
        if other != default_model
    }
    for other, entry in comparisons.items():
        print(f"  {other} minus {default_model}: {entry}")

    print("Clustering zones on pre-test data...")
    clusters = cluster_zones.cluster(rates, zones, dates, weekday, test_start, config.SEED)

    np.savez_compressed(
        config.ARTIFACT_DIR / "history.npz",
        rates=rates.astype(np.float32),
        capacity=capacity,
        zones=zones,
        dates=dates,
        weekday=weekday,
    )

    quality = json.loads(config.QUALITY_REPORT.read_text())
    metadata = {
        "artifact_version": config.ARTIFACT_VERSION,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "result_type": "measured",
        "reproducibility": {
            "seed": config.SEED,
            "python": platform.python_version(),
            "scikit_learn": sklearn.__version__,
            "numpy": np.__version__,
            "raw_data_sha256": config.DATA_SHA256,
            "history_sha256": sha256(config.ARTIFACT_DIR / "history.npz"),
        },
        "dataset": {
            "name": "Parking Birmingham",
            "creator": "Daniel Stolfi",
            "repository": "UCI Machine Learning Repository",
            "url": "https://archive.ics.uci.edu/dataset/482/parking+birmingham",
            "doi": "10.24432/C51K5Z",
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "citation": (
                "Stolfi, D. (2017). Parking Birmingham [Dataset]. UCI Machine Learning "
                "Repository. https://doi.org/10.24432/C51K5Z"
            ),
            "changes": (
                "Readings were deduplicated, cleaned, converted to occupancy rates and aligned "
                "to half-hour slots. See docs/DATA.md."
            ),
            "first_date": str(dates[0]),
            "last_date": str(dates[-1]),
            "is_live": False,
        },
        "quality": quality,
        "splits": {
            "unit": "calendar date of the forecast origin; targets stay in the same split",
            "train": {
                "first_date": str(dates[config.MIN_HISTORY_DAYS]),
                "last_date": config.TRAIN_END,
                "rows": int(len(y_train)),
            },
            "validation": {
                "first_date": config.VALIDATION_START,
                "last_date": config.VALIDATION_END,
                "rows": int(len(y_val)),
            },
            "test": {
                "first_date": config.TEST_START,
                "last_date": str(dates[-1]),
                "rows": int(len(y_test)),
                "days_scored": int(len(np.unique(m_test[:, 1]))),
            },
        },
        "features": FEATURE_NAMES,
        "horizon": {"max_steps": MAX_HORIZON, "slot_minutes": 30, "buckets": HORIZON_BUCKETS},
        "interval_coverage_target": INTERVAL_COVERAGE,
        "default_model": default_model,
        "default_model_rule": "Lowest validation RMSE. The test period played no part in this choice.",
        "comparisons_with_default": comparisons,
        "models": results,
        "baselines": baselines,
        "clusters": clusters,
    }
    (config.ARTIFACT_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2))

    print(f"\nFinished in {time.perf_counter() - started:.0f}s\n")
    header = f"{'model':34}{'val RMSE':>10}{'test MAE':>10}{'test RMSE':>11}{'test R2':>9}{'80% cover':>11}{'MB':>7}"
    print(header)
    for key, entry in results.items():
        print(
            f"{entry['label']:34}{entry['validation']['rmse_pct_points']:10.2f}"
            f"{entry['test']['mae_pct_points']:10.2f}{entry['test']['rmse_pct_points']:11.2f}"
            f"{entry['test']['r2']:9.3f}{entry['interval_coverage_test']['overall']:11.3f}"
            f"{entry['artifact_bytes'] / 1e6:7.2f}"
        )
    for key, entry in baselines.items():
        print(
            f"{key:34}{entry['validation']['rmse_pct_points']:10.2f}"
            f"{entry['test']['mae_pct_points']:10.2f}{entry['test']['rmse_pct_points']:11.2f}"
            f"{entry['test']['r2']:9.3f}"
        )
    print(f"\nClusters: k={clusters['chosen_k']} silhouette={clusters['silhouette']} ARI={clusters['stability_ari_mean']}")
    for entry in clusters["clusters"]:
        print(f"  {entry['id']}: {entry['label']} ({entry['size']} zones)")


if __name__ == "__main__":
    main()
