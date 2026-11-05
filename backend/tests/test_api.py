"""End-to-end API tests against the real artifacts."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def meta():
    return client.get("/api/meta").json()


def test_health():
    body = client.get("/api/health").json()
    assert body["status"] == "ok"


def test_meta_states_the_data_is_historical(meta):
    assert meta["dataset"]["is_live"] is False
    assert meta["dataset"]["license"] == "CC BY 4.0"
    assert meta["result_type"] == "measured"
    assert len(meta["zones"]) == 28


def test_snapshot_defaults_to_latest(meta):
    body = client.get("/api/snapshot").json()
    assert body["as_of"] == meta["latest_observed"]
    assert body["is_latest"] is True
    assert 0 <= body["total"]["rate"] <= 1
    assert body["total"]["reporting_zones"] <= body["total"]["all_zones"]


@pytest.mark.parametrize("model", ["knn", "svr", "boosting"])
def test_forecast_from_latest_runs_past_the_end_of_the_data(meta, model):
    zone = "Broad Street"
    body = client.get("/api/forecast", params={"zone": zone, "model": model, "steps": 18}).json()
    assert body["status"] == "ok"
    assert len(body["models"][model]) == 18
    assert all(p["actual"] is None for p in body["points"])
    assert body["points"][0]["time"].endswith("T08:00")
    assert body["points"][0]["crosses_overnight"] is True
    for point in body["models"][model]:
        assert 0 <= point["lower"] <= point["rate"] <= point["upper"] <= 1


def test_replay_returns_actuals_for_comparison():
    params = {"zone": "Broad Street", "model": "all", "steps": 8, "as_of": "2016-12-12T10:30"}
    body = client.get("/api/forecast", params=params).json()
    assert body["is_replay"] is True
    assert set(body["models"]) == {"knn", "svr", "boosting"}
    assert any(p["actual"] is not None for p in body["points"])
    assert body["history"][-1]["time"] == "2016-12-12T10:30"


def test_zone_with_no_recent_reading_gets_a_clear_status_not_a_guess():
    body = client.get("/api/forecast", params={"zone": "NIA South", "model": "knn"}).json()
    assert body["status"] == "no_recent_reading"
    assert body["models"] == {}


@pytest.mark.parametrize(
    "as_of",
    ["2016-11-01T10:30", "2016-12-12T10:10", "2016-12-12T19:00", "2030-01-01T10:30", "soon"],
)
def test_invalid_as_of_is_rejected(as_of):
    response = client.get("/api/forecast", params={"zone": "Broad Street", "as_of": as_of})
    assert response.status_code == 422
    assert "as_of" in response.json()["detail"]


def test_unknown_zone_and_model_are_rejected():
    assert client.get("/api/forecast", params={"zone": "Nope"}).status_code == 404
    bad = client.get("/api/forecast", params={"zone": "Broad Street", "model": "lstm"})
    assert bad.status_code == 422


def test_zone_comparison_filters_change_the_slice():
    everything = client.get("/api/zones").json()
    weekend = client.get("/api/zones", params={"days": 14, "day_type": "weekend"}).json()
    assert weekend["days_selected"] < everything["days_selected"]
    assert len(everything["heatmap"]) == 28
    assert len(everything["heatmap"][0]["cells"]) == 18


def test_every_modelled_zone_has_a_cluster():
    body = client.get("/api/clusters").json()
    assert len(body["zones"]) == 28
    assert sum(c["size"] for c in body["clusters"]) == 28
    assert "no land-use" in body["caveat"]


def test_model_report_has_all_models_and_baselines():
    body = client.get("/api/models").json()
    assert set(body["models"]) == {"knn", "svr", "boosting"}
    assert set(body["baselines"]) == {"persistence", "seasonal_profile"}
    for entry in body["models"].values():
        assert {"mae_pct_points", "rmse_pct_points", "r2"} <= set(entry["test"])
