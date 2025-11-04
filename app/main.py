from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .market_data import MarketDataRequest as MarketDataParams, fetch_market_data
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="CPT Hindsight API", version="0.3.0")

STATIC_DIR = Path(__file__).parent / "static" / "dist"
API_PREFIX = "/api"

AVAILABLE_SYMBOLS = {
    "NHY": "Norsk Hydro",
    "EQNR": "Equinor",
    "AKER": "Aker ASA",
}


class MarketDataRequest(BaseModel):
    tickers: list[str]
    period: str
    interval: str
    data_points: list[str] = Field(alias="dataPoints")

    model_config = {
        "populate_by_name": True,
    }

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")


@app.get("/", response_class=FileResponse)
def index() -> FileResponse:
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Static frontend not built")
    return FileResponse(index_file)


@app.get(f"{API_PREFIX}/symbols")
def list_symbols() -> JSONResponse:
    return JSONResponse(
        [{"symbol": symbol, "name": name} for symbol, name in AVAILABLE_SYMBOLS.items()]
    )


@app.post(f"{API_PREFIX}/market-data")
def get_market_data(request: MarketDataRequest) -> JSONResponse:
    params = MarketDataParams(
        tickers=request.tickers,
        period=request.period,
        interval=request.interval,
        data_points=request.data_points,
    )
    try:
        dataset = fetch_market_data(params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - unexpected errors
        raise HTTPException(status_code=500, detail="Unexpected error retrieving market data.") from exc

    return JSONResponse(
        {
            "tickers": request.tickers,
            "period": request.period,
            "interval": request.interval,
            "dataPoints": request.data_points,
            "data": dataset,
        }
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
