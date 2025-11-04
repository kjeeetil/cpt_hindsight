import React, { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { Line } from "react-chartjs-2";
import type { BacktestResult, EquityPoint, PriceBar } from "./sma";
import { runSmaBacktest } from "./sma";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
);

type StrategyVisibility = {
  strategy: boolean;
  benchmark: boolean;
};

type DateRangeKey = "26w" | "52w" | "104w" | "156w" | "max";

type DateRangeOption = {
  label: string;
  value: DateRangeKey;
  bars: number | "all";
};

const DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { label: "6 months", value: "26w", bars: 26 },
  { label: "1 year", value: "52w", bars: 52 },
  { label: "2 years", value: "104w", bars: 104 },
  { label: "3 years", value: "156w", bars: 156 },
  { label: "Full history", value: "max", bars: "all" },
];

const TIME_UNIT_BY_RANGE: Record<DateRangeKey, "week" | "month" | "quarter" | "year"> = {
  "26w": "week",
  "52w": "month",
  "104w": "month",
  "156w": "quarter",
  max: "quarter",
};

type SymbolInfo = { symbol: string; name: string };

type LoadState = "idle" | "loading" | "success" | "error";

type FetchError = { message: string };

const formatNumber = (value: number | undefined, fractionDigits = 2): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
};

const roundToTwoDecimals = (value: number): number => Math.round(value * 100) / 100;

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

type StrategyChartsProps = {
  symbol: string;
  strategyName: string;
  priceHistory: PriceBar[];
  trades: BacktestResult["trades"];
  equityCurve: EquityPoint[];
  benchmarkCurve: EquityPoint[];
  dateRange: DateRangeKey;
  onDateRangeChange: (value: DateRangeKey) => void;
  visibility: StrategyVisibility;
  onToggleVisibility: (key: keyof StrategyVisibility) => void;
  timeUnit: "week" | "month" | "quarter" | "year";
};

const StrategyCharts: React.FC<StrategyChartsProps> = ({
  symbol,
  strategyName,
  priceHistory,
  trades,
  equityCurve,
  benchmarkCurve,
  dateRange,
  onDateRangeChange,
  visibility,
  onToggleVisibility,
  timeUnit,
}) => {
  const priceChartData = useMemo<ChartData<"line">>(() => {
    const datasets: ChartDataset<"line", { x: string; y: number }[]>[] = [
      {
        label: `${symbol} price`,
        data: priceHistory.map((bar) => ({ x: bar.date, y: roundToTwoDecimals(bar.adjClose) })),
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.1)",
        pointRadius: 0,
        tension: 0.2,
        fill: false,
        parsing: false,
      },
    ];

    if (visibility.strategy) {
      const inRangeDates = new Set(priceHistory.map((bar) => bar.date));
      const buys = trades
        .filter((trade) => inRangeDates.has(trade.entryDate))
        .map((trade) => ({ x: trade.entryDate, y: trade.entryPrice }));
      const sells = trades
        .filter((trade) => inRangeDates.has(trade.exitDate))
        .map((trade) => ({ x: trade.exitDate, y: trade.exitPrice }));

      if (buys.length) {
        datasets.push({
          label: "Buy signal",
          data: buys,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: "#16a34a",
          pointBorderColor: "#16a34a",
          borderColor: "#16a34a",
          pointStyle: "triangle",
          showLine: false,
          parsing: false,
        });
      }

      if (sells.length) {
        datasets.push({
          label: "Sell signal",
          data: sells,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: "#dc2626",
          pointBorderColor: "#dc2626",
          borderColor: "#dc2626",
          pointStyle: "rectRot",
          showLine: false,
          parsing: false,
        });
      }
    }

    return { datasets };
  }, [priceHistory, trades, symbol, visibility.strategy]);

  const equityChartData = useMemo<ChartData<"line">>(() => {
    const datasets: ChartDataset<"line", { x: string; y: number }[]>[] = [];

    if (visibility.strategy) {
      datasets.push({
        label: `${strategyName} equity`,
        data: equityCurve.map((point) => ({ x: point.Date, y: point.Equity })),
        borderColor: "#0f766e",
        backgroundColor: "rgba(15, 118, 110, 0.15)",
        pointRadius: 0,
        tension: 0.2,
        fill: false,
        parsing: false,
      });
    }

    if (visibility.benchmark) {
      datasets.push({
        label: "Benchmark (buy & hold)",
        data: benchmarkCurve.map((point) => ({ x: point.Date, y: point.Equity })),
        borderColor: "#6b7280",
        backgroundColor: "rgba(107, 114, 128, 0.15)",
        pointRadius: 0,
        borderDash: [6, 4],
        tension: 0.15,
        fill: false,
        parsing: false,
      });
    }

    return { datasets };
  }, [benchmarkCurve, equityCurve, strategyName, visibility.benchmark, visibility.strategy]);

  const priceChartOptions = useMemo<ChartOptions<"line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest", axis: "x", intersect: false },
    plugins: {
      legend: { position: "top", labels: { usePointStyle: true } },
      tooltip: {
        callbacks: {
          label: (context) => {
            const { dataset, parsed } = context;
            if (dataset.label === "Buy signal") {
              return `Buy @ ${formatNumber(parsed.y)} NOK`;
            }
            if (dataset.label === "Sell signal") {
              return `Sell @ ${formatNumber(parsed.y)} NOK`;
            }
            return `${dataset.label}: ${formatNumber(parsed.y)} NOK`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "time",
        time: { unit: timeUnit },
        title: { display: true, text: "Date" },
      },
      y: {
        type: "linear",
        title: { display: true, text: "Price (NOK)" },
      },
    },
  }), [timeUnit]);

  const equityChartOptions = useMemo<ChartOptions<"line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest", axis: "x", intersect: false },
    plugins: {
      legend: { position: "top", labels: { usePointStyle: true } },
      tooltip: {
        callbacks: {
          label: (context) => {
            const { dataset, parsed } = context;
            return `${dataset.label}: ${formatNumber(parsed.y)} NOK`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "time",
        time: { unit: timeUnit },
        title: { display: true, text: "Date" },
      },
      y: {
        type: "linear",
        title: { display: true, text: "Equity (NOK)" },
      },
    },
  }), [timeUnit]);

  return (
    <section className="card">
      <div className="card-header">
        <h3>Performance visualizations</h3>
        <div className="chart-controls">
          <label htmlFor="date-range">Date range</label>
          <select
            id="date-range"
            value={dateRange}
            onChange={(event) => onDateRangeChange(event.target.value as DateRangeKey)}
          >
            {DATE_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <fieldset className="strategy-toggle">
            <legend>Series</legend>
            <label>
              <input
                type="checkbox"
                checked={visibility.strategy}
                onChange={() => onToggleVisibility("strategy")}
              />
              {strategyName}
            </label>
            <label>
              <input
                type="checkbox"
                checked={visibility.benchmark}
                onChange={() => onToggleVisibility("benchmark")}
              />
              Benchmark
            </label>
          </fieldset>
        </div>
      </div>
      <div className="chart-grid">
        <div className="chart-panel">
          <h4>Price with trade markers</h4>
          <div className="chart-wrapper">
            <Line options={priceChartOptions} data={priceChartData} />
          </div>
        </div>
        <div className="chart-panel">
          <h4>Equity curves</h4>
          <div className="chart-wrapper">
            <Line options={equityChartOptions} data={equityChartData} />
          </div>
        </div>
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
  const [dateRange, setDateRange] = useState<DateRangeKey>("156w");
  const [visibleStrategies, setVisibleStrategies] = useState<StrategyVisibility>({
    strategy: true,
    benchmark: true,
  });

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
      const payload = await Promise.resolve(runSmaBacktest(symbol));
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

  useEffect(() => {
    setVisibleStrategies({ strategy: true, benchmark: true });
    setDateRange("156w");
  }, [selection]);

  const isLoading = loadState === "loading" || backtestState === "loading";

  const rangeOption = useMemo(() => {
    return (
      DATE_RANGE_OPTIONS.find((option) => option.value === dateRange) ??
      DATE_RANGE_OPTIONS[DATE_RANGE_OPTIONS.length - 1]
    );
  }, [dateRange]);

  const benchmarkCurve = useMemo<EquityPoint[]>(() => {
    if (!result) {
      return [];
    }
    const initialEquity = result.summary.initialEquity ?? result.equityCurve[0]?.Equity ?? 0;
    const firstPrice = result.priceHistory[0]?.adjClose ?? 0;
    if (!initialEquity || !firstPrice) {
      return [];
    }
    return result.priceHistory.map((bar) => ({
      Date: bar.date,
      Equity: roundToTwoDecimals((bar.adjClose / firstPrice) * initialEquity),
    }));
  }, [result]);

  const filteredPriceHistory = useMemo<PriceBar[]>(() => {
    if (!result) {
      return [];
    }
    if (rangeOption.bars === "all") {
      return result.priceHistory;
    }
    return result.priceHistory.slice(-rangeOption.bars);
  }, [rangeOption, result]);

  const filteredEquityCurve = useMemo<EquityPoint[]>(() => {
    if (!result) {
      return [];
    }
    if (rangeOption.bars === "all") {
      return result.equityCurve;
    }
    return result.equityCurve.slice(-rangeOption.bars);
  }, [rangeOption, result]);

  const filteredBenchmarkCurve = useMemo<EquityPoint[]>(() => {
    if (rangeOption.bars === "all") {
      return benchmarkCurve;
    }
    return benchmarkCurve.slice(-rangeOption.bars);
  }, [benchmarkCurve, rangeOption]);

  const filteredTrades = useMemo(() => {
    if (!result) {
      return [];
    }
    const inRangeDates = new Set(filteredPriceHistory.map((bar) => bar.date));
    return result.trades.filter(
      (trade) => inRangeDates.has(trade.entryDate) || inRangeDates.has(trade.exitDate),
    );
  }, [filteredPriceHistory, result]);

  const timeUnit = TIME_UNIT_BY_RANGE[rangeOption.value];

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
            <StrategyCharts
              symbol={result.symbol}
              strategyName={`${result.name} SMA crossover`}
              priceHistory={filteredPriceHistory}
              trades={filteredTrades}
              equityCurve={filteredEquityCurve}
              benchmarkCurve={filteredBenchmarkCurve}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              visibility={visibleStrategies}
              onToggleVisibility={(key) =>
                setVisibleStrategies((prev) => ({ ...prev, [key]: !prev[key] }))
              }
              timeUnit={timeUnit}
            />
            <EquityPreview result={result} />
            <TradesTable result={result} />
          </>
        )}
      </main>
    </div>
  );
};
