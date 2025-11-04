from fastapi import FastAPI, HTTPException

# Lightweight FastAPI scaffold so the container has an entrypoint that Cloud Run can serve.
# Replace the stubbed /backtest implementation with the real backtesting logic when ready.

app = FastAPI(title="CPT Hindsight API", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict:
    """Simple health endpoint so Cloud Run can probe the service."""
    return {"status": "ok"}


@app.post("/backtest")
def backtest(_: dict) -> dict:
    """
    Placeholder endpoint to be wired to engine.backtest_weekly once the API contract is defined.
    """
    raise HTTPException(status_code=501, detail="Backtest endpoint not wired up yet.")
