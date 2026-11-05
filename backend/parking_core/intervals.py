"""Horizon groups used for per-horizon metrics and prediction bands."""

from __future__ import annotations

HORIZON_BUCKETS = [
    {"id": "h1", "label": "1 slot (30 min)", "min": 1, "max": 1},
    {"id": "h2_4", "label": "2-4 slots (1-2 h)", "min": 2, "max": 4},
    {"id": "h5_8", "label": "5-8 slots (2.5-4 h)", "min": 5, "max": 8},
    {"id": "h9_18", "label": "9-18 slots (4.5-9 h)", "min": 9, "max": 18},
]


def bucket_for_horizon(horizon: int) -> str:
    for bucket in HORIZON_BUCKETS:
        if bucket["min"] <= horizon <= bucket["max"]:
            return bucket["id"]
    raise ValueError(f"No bucket for horizon {horizon}")
