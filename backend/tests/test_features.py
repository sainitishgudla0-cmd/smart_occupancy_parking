"""The most important property of this project: features cannot see the future."""

from __future__ import annotations

import numpy as np
import pytest

from parking_core.features import (
    FEATURE_NAMES,
    MAX_HORIZON,
    SLOTS_PER_DAY,
    build_row,
    history_tables,
    impute_row,
)

N_DAYS = 21


@pytest.fixture()
def data():
    rng = np.random.default_rng(0)
    rates = rng.uniform(0.1, 0.9, (2, N_DAYS * SLOTS_PER_DAY))
    weekday = np.array([d % 7 for d in range(N_DAYS)])
    capacity = np.array([100.0, 500.0])
    return rates, weekday, capacity


def row_for(rates, weekday, capacity, zone, origin, horizon):
    zone_mean, slot_mean = history_tables(rates, weekday)
    return build_row(rates, zone_mean, slot_mean, weekday, capacity, zone, origin, horizon)


@pytest.mark.parametrize("horizon", [1, 2, 8, MAX_HORIZON])
@pytest.mark.parametrize("origin", [SLOTS_PER_DAY * 10, SLOTS_PER_DAY * 10 + 9, SLOTS_PER_DAY * 10 + 17])
def test_changing_any_future_reading_does_not_change_features(data, origin, horizon):
    rates, weekday, capacity = data
    before = row_for(rates, weekday, capacity, 0, origin, horizon)
    tampered = rates.copy()
    tampered[0, origin + 1 :] = 0.999
    after = row_for(tampered, weekday, capacity, 0, origin, horizon)
    np.testing.assert_array_equal(before, after)


def test_changing_the_origin_reading_does_change_features(data):
    rates, weekday, capacity = data
    origin = SLOTS_PER_DAY * 10
    before = row_for(rates, weekday, capacity, 0, origin, 1)
    tampered = rates.copy()
    tampered[0, origin] = 0.999
    after = row_for(tampered, weekday, capacity, 0, origin, 1)
    assert after[FEATURE_NAMES.index("rate_now")] == pytest.approx(0.999)
    assert not np.array_equal(before, after)


def test_overnight_flag_and_row_shape(data):
    rates, weekday, capacity = data
    last_slot = SLOTS_PER_DAY * 10 + 17
    row = row_for(rates, weekday, capacity, 0, last_slot, 1)
    assert row.shape == (len(FEATURE_NAMES),)
    assert row[FEATURE_NAMES.index("crosses_overnight")] == 1.0
    same_day = row_for(rates, weekday, capacity, 0, SLOTS_PER_DAY * 10, 1)
    assert same_day[FEATURE_NAMES.index("crosses_overnight")] == 0.0


def test_horizon_limits_are_enforced(data):
    rates, weekday, capacity = data
    with pytest.raises(ValueError):
        row_for(rates, weekday, capacity, 0, SLOTS_PER_DAY * 10, MAX_HORIZON + 1)


def test_imputation_fills_gaps_without_inventing_a_current_reading(data):
    rates, weekday, capacity = data
    origin = SLOTS_PER_DAY * 10
    gappy = rates.copy()
    gappy[0, origin - 1] = np.nan
    gappy[0, origin + 2 - SLOTS_PER_DAY] = np.nan
    row = impute_row(row_for(gappy, weekday, capacity, 0, origin, 2))
    assert np.isfinite(row).all()
    assert row[FEATURE_NAMES.index("rate_now")] == gappy[0, origin]
