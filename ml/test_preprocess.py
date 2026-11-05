"""Tests for the cleaning rules."""

from __future__ import annotations

import numpy as np
import pandas as pd

from preprocess import mask_collapses, mask_spikes, mask_stuck_runs, snap_to_slots


def test_snap_rounds_to_nearest_half_hour():
    frame = pd.DataFrame({"timestamp": pd.to_datetime(["2016-10-04 07:59:42", "2016-10-04 08:25:42"])})
    out = snap_to_slots(frame)
    assert out["slot"].tolist() == [0, 1]
    assert out["offset"].max() < 5


def test_spike_flags_single_outlier_but_not_a_ramp():
    spike = np.array([0.5, 0.5, 0.05, 0.5, 0.5])
    assert mask_spikes(spike, 0.3).tolist() == [False, False, True, False, False]
    ramp = np.array([0.1, 0.45, 0.8, 0.9, 0.95])
    assert not mask_spikes(ramp, 0.3).any()


def test_stuck_run_needs_length_and_ignores_full_car_parks():
    stuck = np.array([0.1] + [0.4] * 9 + [0.2])
    assert mask_stuck_runs(stuck, 9).sum() == 9
    full = np.array([0.9] + [1.0] * 12 + [0.9])
    assert not mask_stuck_runs(full, 9).any()
    short = np.array([0.1] + [0.4] * 8 + [0.2])
    assert not mask_stuck_runs(short, 9).any()


def test_collapse_is_detected_within_a_day_but_not_overnight():
    within = np.full(36, 0.9)
    within[14:18] = 0.02
    flagged = mask_collapses(within, 0.5)
    assert flagged[14:18].all() and not flagged[:14].any() and not flagged[18:].any()

    overnight = np.full(36, 0.9)
    overnight[18:] = 0.02
    assert not mask_collapses(overnight, 0.5).any()
