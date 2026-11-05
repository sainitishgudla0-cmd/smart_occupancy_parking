"""FastAPI service for the parking dashboard. Vercel entrypoint: main:app."""

from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from parking_core.service import InputError, ParkingService

app = FastAPI(
    title="Smart Parking Occupancy API",
    description="Forecasts and summaries from a historical 2016 dataset. Not a live feed.",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)
service = ParkingService()

# Results depend only on the deployed artifacts, so browsers and the CDN may reuse them.
CACHE_HEADER = "public, max-age=300, s-maxage=3600"


@app.exception_handler(InputError)
async def input_error(_, error: InputError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(error)})


@app.exception_handler(FileNotFoundError)
async def missing_artifact(_, error: FileNotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "Model artifacts are missing. Run ml/train.py before starting the API."},
    )


@app.get("/api/health")
def health(response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "ok",
        "artifact_version": service.metadata["artifact_version"],
        "scikit_learn": service.metadata["reproducibility"]["scikit_learn"],
    }


@app.get("/api/meta")
def meta(response: Response) -> dict:
    response.headers["Cache-Control"] = CACHE_HEADER
    return service.meta()


@app.get("/api/snapshot")
def snapshot(response: Response, as_of: str | None = None) -> dict:
    response.headers["Cache-Control"] = CACHE_HEADER
    return service.snapshot(as_of)


@app.get("/api/forecast")
def forecast(
    response: Response,
    zone: str,
    model: str = "boosting",
    steps: int = Query(default=8, ge=1, le=18),
    as_of: str | None = None,
) -> dict:
    response.headers["Cache-Control"] = CACHE_HEADER
    try:
        return service.forecast(zone, model, steps, as_of)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=f"Unknown zone: {zone}") from error


@app.get("/api/zones")
def zones(
    response: Response,
    days: int | None = Query(default=None, ge=1, le=120),
    day_type: Literal["all", "weekday", "weekend"] = "all",
) -> dict:
    response.headers["Cache-Control"] = CACHE_HEADER
    return service.zone_comparison(days, day_type)


@app.get("/api/clusters")
def clusters(response: Response) -> dict:
    response.headers["Cache-Control"] = CACHE_HEADER
    return service.clusters()


@app.get("/api/models")
def models(response: Response) -> dict:
    response.headers["Cache-Control"] = CACHE_HEADER
    return service.model_report()
