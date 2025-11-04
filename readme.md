# CPT Hindsight — Oslo Stock Exchange Backtesting Web App

Overview
--------
CPT Hindsight is a small web application project that allows users to select stocks traded on the Oslo Stock Exchange and run backtests of trading strategies entirely in the browser (client-side processing). The app provides a set of basic trading strategies, lets the user choose a historical period for backtesting, and returns a trade summary plus a comparison between chosen strategy(ies) and a simple buy-and-hold benchmark. Plotting and visual summaries are integrated to make the comparison intuitive.

Key goals
- Client-side processing of historical price data to keep the app responsive and avoid server overhead.
- A small set of well-documented baseline strategies for quick experimentation (e.g., moving-average crossover, RSI threshold, momentum).
- Clear comparison vs buy-and-hold to show value added by strategies.
- Interactive plotting of price series, trades, equity curves and simple performance metrics.

Core features (MVP)
- Stock selector populated with a curated list of OSE tickers.
- Period selector: start/end dates and preset ranges (1M, 3M, 6M, 1Y, max).
- Strategy selector: choose one or multiple strategies from the built-in list.
- Backtest runner (client-side): compute signals, execute simulated trades, track PnL and portfolio equity.
- Summary report: trade list, win/loss, max drawdown, CAGR (or equivalent), and comparison table vs buy-and-hold.
- Plots: price chart with trade markers, equity curves for each strategy and buy-and-hold, and basic performance charts.
- Export: download trades and summary as CSV.

Design notes
- Processing on the user side (browser) enables instant interactivity and simplifies hosting; price data can be fetched via API or pre-downloaded CSVs.
- The existing engine.py contains the basic computation and plotting logic. For the web app we will:
  - Keep engine.py as a canonical reference implementation for calculations.
  - Refactor its core logic into small, pure functions that can be ported to JavaScript/TypeScript for client execution (or run via Pyodide if Python-in-browser is desired).
- UI will be a single-page application (SPA) with reactive components to run backtests and render plots without page reloads.

Basic strategies (initial set)
- Buy & Hold (benchmark)
- Simple Moving Average (SMA) crossover (fast/slow)
- Exponential Moving Average (EMA) crossover
- Relative Strength Index (RSI) threshold strategy (overbought/oversold)
- Momentum (price change over N days)
- Volatility breakout (ATR-based) — optional for later

Roadmap (prioritized)
1. MVP (1–2 sprints)
   - Deliverable: single-page UI that can select ticker + period, run one strategy, show trade list + equity curve + buy-and-hold comparison.
   - Tasks:
     - Create minimal UI (ticker selector, date picker, strategy dropdown, run button).
     - Implement client-side data loader (CSV or API wrapper).
     - Port a minimal calculation engine for SMA crossover + buy-and-hold into the client.
     - Add plotting (e.g., Chart.js, Plotly or lightweight D3 wrappers).
     - Basic tests and sample datasets.

2. Strategy library & multi-strategy comparison (1 sprint)
   - Deliverable: 4–5 strategies implemented, allow batch runs and overlay comparisons.
   - Tasks:
     - Implement EMA, RSI, momentum strategies client-side.
     - Batch execution and normalized equity-curve plotting.
     - Tabulated comparison metrics and per-trade export.

3. UX improvements & parameter tuning (1 sprint)
   - Deliverable: parameter inputs for each strategy, presets, and a simple optimizer UI for parameter sweep.
   - Tasks:
     - Strategy parameter forms and validation.
     - Parallel runs for parameter grids (client-side compute considerations).
     - Caching of computed results for faster re-runs.

4. Refactor engine.py into web-centric modules (1–2 sprints)
   - Deliverable: engine split into small pure functions and reference implementations for Python and JS.
   - Tasks:
     - Extract signal-generation and trade-execution logic to independent functions with clear I/O.
     - Add comprehensive unit tests for the Python reference functions.
     - Implement or document JS/TS ports of core functions (optionally using Pyodide for Python-in-browser fallback).

5. Advanced features (later)
   - Performance metrics expansion (Sharpe, Sortino), transaction costs and slippage models, multi-asset portfolios, position sizing rules, and strategy persistence/sharing.
   - Consider server-side compute for heavy parameter sweeps or long histories if client becomes limiting.

Implementation notes & recommendations
- Data format: standardized OHLCV CSV or JSON with timestamp, open, high, low, close, volume columns.
- Time zone handling: normalize timestamps to a consistent timezone before backtesting.
- Trading assumptions: define trade execution rules clearly (next-bar open, close, or intraday assumptions) and include transaction cost parameters.
- Plotting: show trade markers (buy/sell) on price chart and separate equity-curve plot for clarity; include simple tooltips.
- Performance: for large datasets consider web workers to keep UI thread responsive.

How to proceed now
- Use the README to align contributors on scope and immediate next steps (MVP).
- Begin by extracting minimal functions from engine.py for SMA crossover and buy-and-hold; implement a small SPA UI to call those functions with sample CSV data.
- Track progress against the roadmap, keeping the engine.py refactor as an explicit milestone.

License & contribution
- Add your preferred license and contribution guidelines in repo root when ready. Keep the readme focused on scope and roadmap for now.

Deployment (Google Cloud)
-------------------------
The repository now includes a minimal container + Cloud Build scaffold for deploying the API skeleton to Cloud Run.

1. Create the Artifact Registry repository and Cloud Run service ahead of time:
   ```
   gcloud artifacts repositories create cpt-hindsight \
     --project "${PROJECT_ID}" \
     --repository-format=docker \
     --location=europe-west1

   gcloud run deploy cpt-hindsight \
     --project "${PROJECT_ID}" \
     --image="europe-west1-docker.pkg.dev/${PROJECT_ID}/cpt-hindsight/cpt-hindsight:bootstrap" \
     --region=europe-west1 \
     --platform=managed \
     --allow-unauthenticated
   ```
   Replace names/regions if you want a different location or service identifier.

2. Submit builds with the provided pipeline:
   ```
   gcloud builds submit \
     --config=cloudbuild.yaml \
     --substitutions=_LOCATION=europe-west1,_REPOSITORY=cpt-hindsight,_SERVICE_NAME=cpt-hindsight,_MAX_IMAGE_VERSIONS=5
   ```

3. The pipeline will:
   - Build the container from the Dockerfile.
   - Push it to Artifact Registry under `${_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${_REPOSITORY}/${_SERVICE_NAME}:${SHORT_SHA}`.
   - Deploy the image to Cloud Run.
   - Prune older image digests, keeping only the `_MAX_IMAGE_VERSIONS` most recent copies so storage does not grow without bound.

Adjust the substitutions to match your project naming, and update the `_MAX_IMAGE_VERSIONS` value if you want to retain more or fewer historical artifacts.

Web demo (local)
----------------
- Run `uvicorn app.main:app --port 8080 --reload`.
- Open `http://localhost:8080` and pick one of the pre-configured Oslo Bors tickers (Norsk Hydro, Equinor or Aker ASA).
- The app generates synthetic weekly OHLC prices, builds simple SMA-crossover signals, and feeds them into `engine.backtest_weekly`.
- You will see a summary, the latest equity-curve points, and the table of completed trades returned by the engine.

Testing
-------
Install development dependencies and run the automated test suite:

```
pip install -r requirements-dev.txt
pytest
```

The suite includes unit tests for the backtesting engine and integration checks for FastAPI endpoints. Deterministic CSV fixtures under `tests/fixtures/` validate strategy outcomes so regressions are easy to spot.
