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
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>CPT Hindsight - Quick Backtest</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 2rem; background: #f4f6f8; color: #222; }}
        h1 {{ margin-bottom: 0.5rem; }}
        form {{ margin-bottom: 1.5rem; }}
        label {{ display: inline-block; margin-right: 1rem; }}
        select {{ padding: 0.4rem; font-size: 1rem; }}
        button {{ padding: 0.4rem 1rem; font-size: 1rem; cursor: pointer; }}
        #results {{ background: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 1rem; }}
        th, td {{ border: 1px solid #ddd; padding: 0.5rem; text-align: left; }}
        th {{ background: #f0f3f5; }}
        pre {{ white-space: pre-wrap; word-break: break-word; }}
    </style>
</head>
<body>
    <h1>Oslo Bors Strategy Backtest</h1>
    <p>Select a stock and run the sample SMA crossover backtest.</p>
    <form id="backtest-form">
        <label for="symbol">Ticker</label>
        <select id="symbol" name="symbol">
            __OPTIONS__
        </select>
        <button type="submit">Run Backtest</button>
    </form>
    <div id="results">
        <strong>Waiting for your first backtest...</strong>
    </div>
    <script>
        const form = document.getElementById("backtest-form");
        const resultsEl = document.getElementById("results");

        form.addEventListener("submit", async (event) => {{
            event.preventDefault();
            const symbol = document.getElementById("symbol").value;
            resultsEl.innerHTML = "<em>Running backtest...</em>";
            try {{
                const response = await fetch("/backtest", {{
                    method: "POST",
                    headers: {{
                        "Content-Type": "application/json"
                    }},
                    body: JSON.stringify({{ symbol }})
                }});
                if (!response.ok) {{
                    const error = await response.json();
                    throw new Error(error.detail || "Unknown error");
                }}
                const data = await response.json();
                resultsEl.innerHTML = renderResults(data);
            }} catch (err) {{
                resultsEl.innerHTML = `<span style="color: red;">Failed: ${{err.message}}</span>`;
            }}
        }});

        function renderResults(data) {{
            const summary = data.summary;
            const trades = data.trades;
            const curvePoints = data.equity_curve.slice(-5);

            const summaryHtml = `
                <h2>${{data.name}} (${{data.symbol}})</h2>
                <p>
                    Final equity: <strong>${{summary.final_equity.toLocaleString(undefined, {{maximumFractionDigits: 2}})}} NOK</strong><br/>
                    Total return: <strong>${{summary.total_return_pct}}%</strong><br/>
                    Trades: <strong>${{summary.trade_count}}</strong>, Win rate: <strong>${{summary.win_rate_pct}}%</strong>
                </p>
            `;

            const tradesHtml = trades.length
                ? `<table>
                    <thead>
                        <tr>
                            <th>Entry</th><th>Exit</th><th>Entry Px</th><th>Exit Px</th><th>Shares</th><th>PnL</th><th>Return %</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${{trades.map(t => `
                            <tr>
                                <td>${{t.entry_date}}</td>
                                <td>${{t.exit_date}}</td>
                                <td>${{t.entry_price}}</td>
                                <td>${{t.exit_price}}</td>
                                <td>${{t.shares}}</td>
                                <td>${{t.pnl}}</td>
                                <td>${{t.return_pct}}</td>
                            </tr>`).join("")}
                    </tbody>
                </table>`
                : "<p>No completed trades.</p>";

            const curveHtml = `
                <h3>Recent Equity Curve (last 5 points)</h3>
                <pre>${{curvePoints.map(p => `${{p.Date}} : ${{p.Equity.toFixed(2)}}`).join("\\n")}}</pre>
            `;

            return summaryHtml + curveHtml + tradesHtml;
        }
    </script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    options_html = "".join(
        f'<option value="{symbol}">{name}</option>' for symbol, name in AVAILABLE_SYMBOLS.items()
    )
    html = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>CPT Hindsight - Quick Backtest</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 2rem; background: #f4f6f8; color: #222; }}
            h1 {{ margin-bottom: 0.5rem; }}
            form {{ margin-bottom: 1.5rem; }}
            label {{ display: inline-block; margin-right: 1rem; }}
            select {{ padding: 0.4rem; font-size: 1rem; }}
            button {{ padding: 0.4rem 1rem; font-size: 1rem; cursor: pointer; }}
            #results {{ background: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); }}
            table {{ width: 100%; border-collapse: collapse; margin-top: 1rem; }}
            th, td {{ border: 1px solid #ddd; padding: 0.5rem; text-align: left; }}
            th {{ background: #f0f3f5; }}
            pre {{ white-space: pre-wrap; word-break: break-word; }}
        </style>
    </head>
    <body>
        <h1>Oslo Bors Strategy Backtest</h1>
        <p>Select a stock and run the sample SMA crossover backtest.</p>
        <form id="backtest-form">
            <label for="symbol">Ticker</label>
            <select id="symbol" name="symbol">
                {options_html}
            </select>
            <button type="submit">Run Backtest</button>
        </form>
        <div id="results">
            <strong>Waiting for your first backtest...</strong>
        </div>
        <script>
            const form = document.getElementById("backtest-form");
            const resultsEl = document.getElementById("results");

            form.addEventListener("submit", async (event) => {{
                event.preventDefault();
                const symbol = document.getElementById("symbol").value;
                resultsEl.innerHTML = "<em>Running backtest...</em>";
                try {{
                    const response = await fetch("/backtest", {{
                        method: "POST",
                        headers: {{
                            "Content-Type": "application/json"
                        }},
                        body: JSON.stringify({{ symbol }})
                    }});
                    if (!response.ok) {{
                        const error = await response.json();
                        throw new Error(error.detail || "Unknown error");
                    }}
                    const data = await response.json();
                    resultsEl.innerHTML = renderResults(data);
                }} catch (err) {{
                    resultsEl.innerHTML = `<span style="color: red;">Failed: ${{err.message}}</span>`;
                }}
            }});

            function renderResults(data) {{
                const summary = data.summary;
                const trades = data.trades;
                const curvePoints = data.equity_curve.slice(-5);

                const summaryHtml = `
                <h2>${{data.name}} (${{data.symbol}})</h2>
                    <p>
                        Final equity: <strong>${{summary.final_equity.toLocaleString(undefined, {{maximumFractionDigits: 2}})}} NOK</strong><br/>
                        Total return: <strong>${{summary.total_return_pct}}%</strong><br/>
                        Trades: <strong>${{summary.trade_count}}</strong>, Win rate: <strong>${{summary.win_rate_pct}}%</strong>
                    </p>
                `;

                const tradesHtml = trades.length
                    ? `<table>
                        <thead>
                            <tr>
                                <th>Entry</th><th>Exit</th><th>Entry Px</th><th>Exit Px</th><th>Shares</th><th>PnL</th><th>Return %</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${{trades.map(t => `
                                <tr>
                                    <td>${{t.entry_date}}</td>
                                    <td>${{t.exit_date}}</td>
                                    <td>${{t.entry_price}}</td>
                                    <td>${{t.exit_price}}</td>
                                    <td>${{t.shares}}</td>
                                    <td>${{t.pnl}}</td>
                                    <td>${{t.return_pct}}</td>
                                </tr>`).join("")}}
                        </tbody>
                    </table>`
                    : "<p>No completed trades.</p>";

                const curveHtml = `
                    <h3>Recent Equity Curve (last 5 points)</h3>
                    <pre>${{curvePoints.map(p => `${{p.Date}} : ${{p.Equity.toFixed(2)}}`).join("\\n")}}</pre>
                `;

                return summaryHtml + curveHtml + tradesHtml;
            }}
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html)


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
