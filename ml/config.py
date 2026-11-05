"""Paths and fixed decisions shared by the data and training scripts."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
RAW_ZIP = RAW_DIR / "parking_birmingham.zip"
RAW_CSV = RAW_DIR / "dataset.csv"
PROCESSED_GRID = PROCESSED_DIR / "grid.npz"
QUALITY_REPORT = PROCESSED_DIR / "quality_report.json"

ARTIFACT_VERSION = "v1"
ARTIFACT_DIR = BACKEND / "artifacts" / ARTIFACT_VERSION

DATA_URL = "https://archive.ics.uci.edu/static/public/482/parking+birmingham.zip"
DATA_SHA256 = "af7d1b1b5bb85aa6cbf0e5212d06e76470a7fbe6c42c86ea01bf4c36d3a56ad8"

SEED = 42

# Chronological split, by the calendar date of the forecast origin.
TRAIN_END = "2016-11-20"
VALIDATION_START = "2016-11-21"
VALIDATION_END = "2016-12-04"
TEST_START = "2016-12-05"

# Forecast origins need a week of history for the weekly lag to exist.
MIN_HISTORY_DAYS = 7

# Cleaning thresholds, justified in docs/DATA.md.
MIN_OBSERVED_DAYS = 30
MAX_OVER_CAPACITY_RATIO = 1.10
SPIKE_THRESHOLD = 0.30
STUCK_RUN_SLOTS = 9
COLLAPSE_THRESHOLD = 0.50
