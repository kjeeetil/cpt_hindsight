# CPT Hindsight — Oslo Stock Exchange Backtesting Web App

Overview
--------
CPT Hindsight is a FastAPI + React project for exploring trading strategies on a curated set of Oslo Stock Exchange tickers. The backend exposes a lightweight API, serves a compiled single-page application (SPA), and remains the source of truth for server-side calculations. The SPA, written in TypeScript, mirrors the minimal SMA crossover logic so that users can prototype in the browser while still having access to authoritative server computations.

Key goals
- API-first backend that can perform canonical strategy calculations and stream static metadata to clients.
- React/Vite-style SPA hosted under `app/static/dist/` that keeps the UI responsive without page reloads.
- Client-side TypeScript modules that reproduce the simple SMA crossover simulation for fast iteration.
- Clear separation between frontend presentation, local simulation utilities, and server endpoints.
- Smooth upgrade path toward more advanced strategies or heavier server-side workloads.

Architecture
------------
- **Backend**: FastAPI application (`app/main.py`) that mounts compiled assets under `/static`, serves the SPA entry point on `/`, and exposes JSON endpoints under `/api/*`.
  - `/api/symbols` returns the curated ticker list.
  - `/api/backtest` keeps the legacy Python backtester available for server-side parity or heavier workloads.
  - `/healthz` is retained for deployment probes.
- **Frontend**: React SPA bundled with esbuild. Source files live in `app/static/src/` and compile into `app/static/dist/` via `npm run build`.
- **Simulation utilities**: `app/static/src/sma.ts` ports the minimal SMA crossover strategy to TypeScript so the browser can generate synthetic data, run the crossover logic locally, and render the results without waiting on the API.

State management & UX
---------------------
- The SPA fetches tickers once, stores them in local state, and re-runs the TypeScript backtester whenever the selection changes.
- Loading states, optimistic updates, and error messaging are handled via React state hooks, keeping the interface responsive without page reloads.
- The UI surfaces headline metrics, an equity preview, and a trade table that mirror the previous HTML prototype while adopting a modern card layout.

Development workflow
--------------------
1. Install Node.js dependencies once: `npm install`.
2. Build the frontend bundle: `npm run build` (outputs to `app/static/dist/assets`).
3. Run the API locally: `uvicorn app.main:app --port 8080 --reload`.
4. Navigate to `http://localhost:8080` — the SPA loads, fetches `/api/symbols`, and executes the SMA backtest locally.

Backtesting strategies
----------------------
- **Simple Moving Average (SMA) crossover**: Implemented in Python (`app/backtester.py`) and TypeScript (`app/static/src/sma.ts`).
- Future strategies can be added on the server for canonical results and selectively ported to TypeScript for in-browser experimentation.

Roadmap (prioritized)
1. **MVP hardening**
   - Enrich result visualizations (charts, overlays) while keeping the SPA responsive.
   - Expand test coverage for the TypeScript modules and Python API endpoints.
2. **Strategy library expansion**
   - Add EMA, RSI, and momentum strategies to the Python engine first, then port reusable pieces to TypeScript as needed.
   - Support parameter inputs with synchronized validation between client and server.
3. **Server-side compute enhancements**
   - Introduce queueable backtests for longer histories or parameter sweeps, returning job metadata through the API.
   - Cache canonical results so the SPA can reconcile local simulations with authoritative server-side outputs.
4. **Collaboration & persistence**
   - Allow saving strategy presets, sharing links, and exporting results.

Implementation notes & recommendations
- Data format: synthetic weekly OHLC data is generated deterministically in both Python and TypeScript for consistency.
- Time zone handling: normalize timestamps to a consistent timezone before performing calculations.
- Trading assumptions: execution happens on the following week's open price with a simple position-sizing heuristic; extend both implementations in tandem when refining the model.
- Plotting: consider integrating lightweight charting libraries (e.g., `visx`, `Recharts`) once richer visualization is required.
- Performance: web workers or server jobs should handle heavier parameter sweeps; the current SPA keeps interactions instant for a single symbol.

Deployment (Google Cloud)
-------------------------
The repository includes a minimal container + Cloud Build scaffold for deploying the API skeleton to Cloud Run.

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
- Open `http://localhost:8080` and select a ticker from the dropdown.
- The SPA fetches the ticker metadata, runs the TypeScript SMA backtest locally, and renders summary metrics, a rolling equity snapshot, and the trade table.
- To cross-check results against the Python implementation, submit a POST request to `/api/backtest` with `{ "symbol": "NHY" }` and compare the payloads.
