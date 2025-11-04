from __future__ import annotations

import csv
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .market_data import MarketDataRequest as MarketDataParams, fetch_market_data
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="CPT Hindsight API", version="0.3.0")

STATIC_DIR = Path(__file__).parent / "static" / "dist"
DATA_DIR = Path(__file__).parent / "data"
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
def _load_history(symbol: str) -> list[dict[str, object]]:
    csv_path = DATA_DIR / f"{symbol}.csv"
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail=f"No OHLCV bundle for {symbol}")

    rows: list[dict[str, object]] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                rows.append(
                    {
                        "Date": row["Date"],
                        "Open": float(row["Open"]),
                        "High": float(row["High"]),
                        "Low": float(row["Low"]),
                        "Close": float(row["Close"]),
                        "Adj Close": float(row["Adj Close"]),
                        "Volume": int(float(row["Volume"])) if row["Volume"] is not None else None,
                    }
                )
            except (KeyError, TypeError, ValueError) as exc:  # pragma: no cover - defensive
                raise HTTPException(status_code=500, detail=f"Malformed OHLCV row for {symbol}") from exc
    if not rows:
        raise HTTPException(status_code=404, detail=f"OHLCV bundle for {symbol} is empty")
    return rows


@app.get(f"{API_PREFIX}/ohlcv/{{symbol}}")
def fetch_history(symbol: str) -> JSONResponse:
    normalized_symbol = symbol.upper()
    if normalized_symbol not in AVAILABLE_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Unknown symbol {symbol}")
    history = _load_history(normalized_symbol)
    return JSONResponse(
        {
            "symbol": normalized_symbol,
            "name": AVAILABLE_SYMBOLS[normalized_symbol],
            "history": history,
        }
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
