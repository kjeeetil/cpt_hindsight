import React, { useEffect, useMemo, useState } from "react";
import type { BacktestResult } from "./sma";
import { runSmaBacktest } from "./sma";

type SymbolInfo = { symbol: string; name: string };

type LoadState = "idle" | "loading" | "success" | "error";

type FetchError = { message: string };

const formatNumber = (value: number | undefined, fractionDigits = 2): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
};

const SummaryCard: React.FC<{ result: BacktestResult }> = ({ result }) => {
  const { summary } = result;
  return (
    <section className="card">
      <h2>
        {result.name} ({result.symbol})
      </h2>
      <div className="metrics">
        <div>
          <span className="label">Final equity</span>
          <span className="value">{formatNumber(summary.finalEquity)} NOK</span>
        </div>
        <div>
          <span className="label">Total return</span>
          <span className="value">{formatNumber(summary.totalReturnPct)}%</span>
        </div>
        <div>
          <span className="label">Trades</span>
          <span className="value">{summary.tradeCount}</span>
        </div>
        <div>
          <span className="label">Win rate</span>
          <span className="value">{formatNumber(summary.winRatePct)}%</span>
        </div>
      </div>
    </section>
  );
};

const EquityPreview: React.FC<{ result: BacktestResult }> = ({ result }) => {
  const lastPoints = useMemo(() => result.equityCurve.slice(-10), [result.equityCurve]);
  return (
    <section className="card">
      <h3>Equity curve (last 10 weeks)</h3>
      <div className="equity-preview">
        {lastPoints.map((point) => (
          <div key={point.Date} className="equity-row">
            <span>{point.Date}</span>
            <span>{formatNumber(point.Equity)}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

const TradesTable: React.FC<{ result: BacktestResult }> = ({ result }) => {
  if (!result.trades.length) {
    return (
      <section className="card">
        <h3>Trades</h3>
        <p>No completed trades yet.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h3>Trades</h3>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Entry</th>
              <th>Exit</th>
              <th>Entry Px</th>
              <th>Exit Px</th>
              <th>Shares</th>
              <th>PnL</th>
              <th>Return %</th>
            </tr>
          </thead>
          <tbody>
            {result.trades.map((trade) => (
              <tr key={`${trade.entryDate}-${trade.exitDate}`}>
                <td>{trade.entryDate}</td>
                <td>{trade.exitDate}</td>
                <td>{formatNumber(trade.entryPrice)}</td>
                <td>{formatNumber(trade.exitPrice)}</td>
                <td>{formatNumber(trade.shares, 0)}</td>
                <td>{formatNumber(trade.pnl)}</td>
                <td>{formatNumber(trade.returnPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export const App: React.FC = () => {
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [selection, setSelection] = useState<string>("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [backtestState, setBacktestState] = useState<LoadState>("idle");
  const [error, setError] = useState<FetchError | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoadState("loading");
      try {
        const response = await fetch("/api/symbols");
        if (!response.ok) {
          throw new Error(`Failed to load symbols (${response.status})`);
        }
        const payload: SymbolInfo[] = await response.json();
        setSymbols(payload);
        setSelection(payload[0]?.symbol ?? "");
        setLoadState("success");
      } catch (err) {
        setLoadState("error");
        setError({ message: err instanceof Error ? err.message : "Unknown error" });
      }
    };
    load();
  }, []);

  const runBacktest = async (symbol: string) => {
    setBacktestState("loading");
    setError(null);
    try {
      const payload = await runSmaBacktest(symbol);
      setResult(payload);
      setBacktestState("success");
    } catch (err) {
      setBacktestState("error");
      setError({ message: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  useEffect(() => {
    if (selection) {
      runBacktest(selection);
    }
  }, [selection]);

  const isLoading = loadState === "loading" || backtestState === "loading";

  return (
    <div className="app">
      <header>
        <h1>CPT Hindsight</h1>
        <p>Client-side SMA crossover sandbox backed by a lightweight FastAPI metadata service.</p>
      </header>
      <main>
        <section className="card">
          <h2>Run backtest</h2>
          {loadState === "loading" && <p>Loading symbols…</p>}
          {loadState === "error" && <p className="error">{error?.message ?? "Failed to load symbols"}</p>}
          {loadState === "success" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (selection) {
                  runBacktest(selection);
                }
              }}
            >
              <label htmlFor="symbol">Ticker</label>
              <select
                id="symbol"
                value={selection}
                onChange={(event) => setSelection(event.target.value)}
              >
                {symbols.map((info) => (
                  <option key={info.symbol} value={info.symbol}>
                    {info.symbol} — {info.name}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={!selection || isLoading}>
                {backtestState === "loading" ? "Running…" : "Run backtest"}
              </button>
            </form>
          )}
        </section>

        {error && backtestState === "error" && (
          <section className="card">
            <p className="error">{error.message}</p>
          </section>
        )}

        {backtestState === "loading" && (
          <section className="card">
            <p>Calculating SMA strategy locally…</p>
          </section>
        )}

        {result && backtestState === "success" && (
          <>
            <SummaryCard result={result} />
            <EquityPreview result={result} />
            <TradesTable result={result} />
          </>
        )}
      </main>
    </div>
  );
};
