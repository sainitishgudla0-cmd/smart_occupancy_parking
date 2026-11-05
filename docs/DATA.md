# Data notes

## Source

| | |
|---|---|
| Dataset | [Parking Birmingham](https://archive.ics.uci.edu/dataset/482/parking+birmingham), UCI Machine Learning Repository |
| Creator | Daniel Stolfi |
| DOI | [10.24432/C51K5Z](https://doi.org/10.24432/C51K5Z) |
| License | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Citation | Stolfi, D. (2017). Parking Birmingham [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C51K5Z |
| Checked | 2026-11-05 |
| File verified | SHA-256 `af7d1b1b5bb85aa6cbf0e5212d06e76470a7fbe6c42c86ea01bf4c36d3a56ad8` |

Fields: `SystemCodeNumber` (car park code), `Capacity`, `Occupancy`, `LastUpdated`.

Coverage: 35,717 rows from 30 car parks, 2016-10-04 to 2016-12-19, about 08:00 to 16:30, roughly every 30 minutes.

CC BY 4.0 permits redistribution with attribution, but the raw file is still not committed. `ml/download_data.py` fetches it and checks its hash. `backend/artifacts/v1/history.npz` holds derived, cleaned occupancy rates, and the dashboard shows the required attribution and describes the changes.

## Cleaning rules and their effect

These counts come from running `ml/preprocess.py`. The full report is saved in `backend/artifacts/v1/metadata.json` under `quality`.

| Issue | Rule | Rows or readings | Why |
|---|---|---|---|
| Blank values | Checked | 0 | The UCI page says the data has missing values, but no field is blank. The gaps are absent rows. |
| Exact duplicates | Removed | 216 | Same car park, time and value. |
| Negative occupancy | Removed | 12 | Impossible. All are from NIA North. |
| Above capacity | Set to 100% full | 373 | The largest excess is about 4%, consistent with counter drift. A rule that removes readings above 110% of capacity is also in place and affected 0 rows. |
| Readings from 07:30 to 07:45 | Removed | 21 | They round to a slot before the 08:00 start of the grid. |
| Several readings in one slot | Keep the closest in time | 52 | After rounding to the half hour. |
| Frozen feed | At least 9 identical readings in a row (4.5 hours), below 100%, are masked | 14 | All from BHMEURBRD02. Long runs at exactly 100% are kept, since a car park can really stay full. |
| Sudden collapse | A fall of more than 50% of capacity in one slot within a day masks the rest of that day | 4 | One event: BHMBCCPST01 on 2016-10-22 fell from 100% to 4% at 15:00 and stayed near zero. Overnight falls are normal and not affected. |
| Isolated spike | A one-slot jump of over 30% that returns is masked | 0 | The rule stays in place but found nothing. |
| Too little data | Car parks with under 30 observed days are excluded | 2 | BHMBRTARC01 (5 days) and NIA North (9 days). |

Other observations:

- **Whole days missing:** 2016-10-20, 10-21, 12-03 and 12-04 have no data for any car park. They are left empty.
- **Gaps are not filled.** After cleaning, 90.6% of the grid has a reading. Forecast targets are never invented. Where a lag feature is missing, a fallback built only from values known at that moment is used (see `impute_row` in `backend/parking_core/features.py`).
- **Time zone:** the source does not state one. The median first reading of the day is 08:00 both before and after British Summer Time ended on 2016-10-30, which suggests local time but does not prove it.
- **Capacity** is constant for every car park in the file.

## Known limitations

- About eleven weeks in autumn 2016. No yearly seasons, and nothing about the present day.
- No readings outside the operating window, so overnight changes can't be observed.
- No events, weather, prices or closures.
- The source does not explain its car park codes. Some may overlap (for example NIA Car Parks and NIA South), so city totals on the dashboard could count some spaces twice. The dashboard reports what the source reports.
- Thresholds were chosen by inspecting this one file. They suit it and are not a general sensor-cleaning method.
