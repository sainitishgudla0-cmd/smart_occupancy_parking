# Smart Parking Occupancy Prediction

A parking operations dashboard built on real public data. It cleans historical occupancy readings, forecasts occupancy for each car park, compares KNN, SVR and boosting regressors, and groups car parks by demand pattern.

**This is a historical demonstration, not a live system.** The data ends on 19 December 2016. It has no sensor connection, reservations or navigation.

## Stack

| Part | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Recharts |
| API | FastAPI on the Vercel Python runtime |
| Models | scikit-learn, trained locally and deployed as versioned files |
| Deployment | One Vercel project using [Services](https://vercel.com/docs/services) (Beta) |

```
frontend/              Next.js dashboard
backend/
  main.py              API routes (Vercel entrypoint main:app)
  parking_core/        Inference code and features, shared with training
  artifacts/v1/        Trained models, cleaned history, metadata (committed)
  requirements.txt     Pinned runtime dependencies
  tests/               Leakage and API tests
ml/                    Download, cleaning, training and clustering (never deployed)
docs/DATA.md           Dataset details and cleaning rules
vercel.json            Services and public routing
```

## Run locally

You need Node.js 20.9+, [uv](https://docs.astral.sh/uv/) and internet access for the first install. These are PowerShell commands, run from the project folder. The models are already in the repository, so training is optional.

```powershell
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r backend\requirements.txt -r ml\requirements.txt
cd frontend
npm ci
cd ..
```

Start the API in one terminal:

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal, then open http://localhost:3000:

```powershell
cd frontend
npm run dev
```

Next.js forwards `/api/*` to port 8000 during development. API docs are at http://127.0.0.1:8000/api/docs.

## Test and build

```powershell
.venv\Scripts\python.exe -m pytest backend/tests ml/test_preprocess.py
cd frontend
npm run typecheck
npm run lint
npm run build
```

## Reproduce the data and models

```powershell
.venv\Scripts\python.exe ml\download_data.py   # downloads and checks the SHA-256
.venv\Scripts\python.exe ml\preprocess.py      # writes data/processed/
.venv\Scripts\python.exe ml\train.py           # about 10 minutes; rewrites backend/artifacts/v1/
```

Random seeds and dependency versions are fixed. Keep the pinned scikit-learn version when loading these files, because saved models are not guaranteed to work across versions. The API never trains and never writes files.

To change dependencies, edit the `.in` file and run the command at the top of `backend/requirements.in`. Retrain if scikit-learn or NumPy changes.

## Data

[Parking Birmingham](https://archive.ics.uci.edu/dataset/482/parking+birmingham), by Daniel Stolfi, from the UCI Machine Learning Repository, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). DOI [10.24432/C51K5Z](https://doi.org/10.24432/C51K5Z).

> Stolfi, D. (2017). Parking Birmingham [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C51K5Z

It holds 35,717 readings from 30 car parks, from 2016-10-04 to 2016-12-19, about 08:00 to 16:30. After cleaning, 28 car parks and 35,163 half-hourly readings remain. The raw file is downloaded rather than committed. The committed `history.npz` is a cleaned, modified derivative. See [docs/DATA.md](docs/DATA.md) for every rule and count.

## Method

**Forecast target:** occupancy rate (occupied divided by capacity) from 1 to 18 half-hour operating slots ahead. There are no readings overnight, so a step after 16:30 lands on 08:00 the next day. One model handles all horizons, with the horizon as a feature.

**Features** use the horizon, target time and weekday, capacity, recent readings, the same slot one day and one week earlier, and running averages computed only from data before the forecast time. `backend/tests/test_features.py` checks that changing future readings does not change any feature.

**Chronological split**, by the date of the forecast origin. Origin and target always stay in the same split:

| Split | Dates | Rows | Use |
|---|---|---|---|
| History only | Oct 4 to Oct 10 | n/a | Provides lags, no rows |
| Train | Oct 11 to Nov 20 | 329,446 | Fit |
| Validation | Nov 21 to Dec 4 | 100,288 | Tune, choose default, calibrate bands |
| Test | Dec 5 to Dec 19 | 120,443 | Final report |

The final models are refit on train and validation, so their training targets all come before the test period.

**Uncertainty:** 80% bands use split-conformal half-widths, calculated from validation errors for each horizon group. They are pooled across car parks, so they aren't calibrated for any single one.

**Clusters:** k-means on six standardized demand features from before the test period. The number of clusters was chosen by silhouette score from 2 to 6.

## Results (measured, not synthetic)

Errors are in percentage points of capacity, on the 15 test days. Brackets show 95% intervals from resampling whole days.

| Method | MAE | RMSE | R² | 80% band coverage |
|---|---|---|---|---|
| SVR (default, by validation RMSE) | 3.97 [3.44, 4.59] | 5.97 [5.03, 6.96] | 0.952 | 79.8% |
| HistGradientBoosting | 4.03 [3.48, 4.65] | 5.90 [5.00, 6.82] | 0.953 | 80.5% |
| KNN | 4.84 [4.25, 5.53] | 6.93 [5.95, 8.01] | 0.935 | 82.0% |
| Baseline: historical average, same slot and day type | 7.04 [6.21, 8.01] | 9.44 [8.26, 10.67] | 0.879 | n/a |
| Baseline: persistence | 18.13 [16.77, 19.68] | 25.89 [24.07, 27.92] | 0.091 | n/a |

How to read these:

- **SVR and boosting are effectively tied.** Their paired MAE difference is 0.05 points, with a 95% interval of -0.05 to 0.20. Both are measurably better than KNN and both baselines.
- **R² flatters every method,** because car parks and times of day differ so much. The historical average alone reaches 0.88, so the comparison with that baseline is more informative.
- **Training sizes differ:** SVR uses 12,000 rows and KNN 40,000, randomly sampled for speed and file size. Boosting uses all 429,734. This compares these fitted models, not each method's best possible result.
- **Search limits:** the chosen boosting settings sit at the edge of the search range for learning rate, leaf count and minimum leaf size, so a wider search might improve it slightly.
- **One disclosure:** a first training run used narrower tuning ranges. After seeing that the best settings sat at the range limits on validation data, I widened the ranges and retrained. Test results from that first run had been displayed by then. Tuning and model choice still read validation data only, and SVR's test MAE moved from 3.86 to 3.97 as a result.

**Clusters:** two, with silhouette 0.46 (moderate separation) and an average adjusted Rand index of 0.88 when days are resampled.

| Cluster | Car parks | Average occupancy | Weekend minus weekday |
|---|---|---|---|
| Higher average occupancy, quieter at weekends | 13 | 63% | -35 pts |
| Lower average occupancy, similar across the week | 15 | 36% | +2 pts |

Labels describe measured patterns only. The dataset doesn't say what a car park is used for.

## Limitations

- Eleven weeks in autumn 2016, with a December test period. Results may not hold for other seasons or for today.
- Daytime readings only, and no data on events, weather, prices or closures.
- Fifteen test days is a small sample, as the intervals above show.
- Readings are as reported, and some sensor errors will have gone undetected.
- The source's time zone and car park codes are undocumented. Some car parks may overlap, so totals could count some spaces twice.

## Deploy to Vercel

The project needs Vercel CLI 62.1 or newer. Services is in Beta, so behavior may change. If it causes problems, the simplest fallback is two Vercel projects, one for `frontend/` and one for `backend/`, with `API_PROXY_TARGET` on the frontend project set to the API's URL.

1. Push this project to a GitHub repository. Choosing public or private is up to you.
2. In Vercel, select **Add New > Project** and import the repository.
3. Set the **Framework Preset** to **Services**, and leave **Root Directory** at the repository root. No environment variables are needed.
4. Deploy, and check the preview URL before promoting it:
   - `/api/health` returns `"status": "ok"`.
   - `/api/forecast?zone=Bull%20Ring&model=svr&steps=4` returns `"status": "ok"`. This confirms the model files reached the function.
   - The Overview, Forecast, Zones, Models and Data pages load, and the filters work.

With the CLI instead:

```powershell
npx vercel@64.7.0 login
npx vercel@64.7.0 link
npx vercel@64.7.0 project update --framework services
npx vercel@64.7.0 deploy
```

### Vercel notes

- [Python functions have a 500 MB uncompressed limit](https://vercel.com/docs/functions/limitations). The Linux runtime dependencies measure about 203 MB, plus 5 MB of artifacts.
- Hobby functions have up to 2 GB of memory and responses are limited to 4.5 MB. The largest response here is well below that.
- The first request after idle will be slower because scikit-learn has to load. KNN is the largest model at about 4 MB.
- `vercel dev -L` may not start on Windows machines with Application Control or Smart App Control enabled, because it creates a new `python.exe` in `backend/.venv`. Use the two-terminal setup above instead.
