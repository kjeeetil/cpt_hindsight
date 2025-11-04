from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .backtester import AVAILABLE_SYMBOLS, backtest_symbol

app = FastAPI(title="CPT Hindsight API", version="0.3.0")

STATIC_DIR = Path(__file__).parent / "static" / "dist"
API_PREFIX = "/api"

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")


class BacktestRequest(BaseModel):
    symbol: str


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


@app.post(f"{API_PREFIX}/backtest")
def run_backtest(req: BacktestRequest) -> JSONResponse:
    symbol = req.symbol.upper()
    if symbol not in AVAILABLE_SYMBOLS:
        raise HTTPException(status_code=400, detail="Unsupported symbol")
    try:
        payload = backtest_symbol(symbol)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return JSONResponse(payload)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
