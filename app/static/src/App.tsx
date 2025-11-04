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

type LoadState = "idle" | "loading" | "success" | "error";

type FetchError = { message: string };

type MarketDataRequestPayload = {
  tickers: string[];
  period: string;
  interval: string;
  dataPoints: string[];
};

type MarketDataRow = {
  timestamp: string;
  [key: string]: number | string;
};

type MarketDataResponse = {
  tickers: string[];
  period: string;
  interval: string;
  dataPoints: string[];
  data: Record<string, MarketDataRow[]>;
};

type BacktestRequestPayload = {
  ticker: string;
  startDate: string;
  endDate: string;
  interval: string;
};

const DATA_POINT_OPTIONS = ["Open", "High", "Low", "Close", "Adj Close", "Volume"];
const PERIOD_OPTIONS = ["1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max"];
const INTERVAL_OPTIONS = ["1d", "1wk", "1mo"];
const BACKTEST_INTERVAL = "1d";

const formatNumber = (value: number | undefined, fractionDigits = 2): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
};

const renderDataValue = (value: number | string | undefined): string => {
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return "-";
};
const roundToTwoDecimals = (value: number): number => Math.round(value * 100) / 100;

const padNumber = (value: number): string => value.toString().padStart(2, "0");

const formatIsoDate = (date: Date): string => {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
};

const parseBacktestRange = (value: string): { startDate: string; endDate: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(
      "Provide a ticker and range like '2023-01-01 to 2023-12-31' or a relative period such as '1y'.",
    );
  }

  const explicitDates = trimmed.match(/\d{4}-\d{2}-\d{2}/g);
  if (explicitDates && explicitDates.length >= 2) {
    const [start, end] = explicitDates;
    if (start > end) {
      throw new Error("Start date must be before the end date.");
    }
    return { startDate: start, endDate: end };
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, "");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (normalized === "ytd") {
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    return { startDate: formatIsoDate(startOfYear), endDate: formatIsoDate(today) };
  }

  const durationMatch = normalized.match(
    /^(\d+)(d|day|days|w|week|weeks|m|mo|month|months|y|yr|year|years)$/,
  );
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2];
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Relative periods must be positive numbers.");
    }
    const start = new Date(today);
    if (["d", "day", "days"].includes(unit)) {
      start.setDate(start.getDate() - amount);
    } else if (["w", "week", "weeks"].includes(unit)) {
      start.setDate(start.getDate() - amount * 7);
    } else if (["m", "mo", "month", "months"].includes(unit)) {
      start.setMonth(start.getMonth() - amount);
    } else if (["y", "yr", "year", "years"].includes(unit)) {
      start.setFullYear(start.getFullYear() - amount);
    }
    if (start > today) {
      throw new Error("Computed start date falls after the end date.");
    }
    return { startDate: formatIsoDate(start), endDate: formatIsoDate(today) };
  }

  throw new Error(
    "Enter either two ISO dates (YYYY-MM-DD) or a relative duration like '6mo' or '1y'.",
  );
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
        data: priceHistory.map((bar) => ({ x: bar.Date, y: roundToTwoDecimals(bar.AdjClose) })),
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.1)",
        pointRadius: 0,
        tension: 0.2,
        fill: false,
        parsing: false,
      },
    ];

    if (visibility.strategy) {
      const inRangeDates = new Set(priceHistory.map((bar) => bar.Date));
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
  const [backtestTicker, setBacktestTicker] = useState<string>("NHY");
  const [backtestRange, setBacktestRange] = useState<string>("1y");
  const [backtestState, setBacktestState] = useState<LoadState>("idle");
  const [error, setError] = useState<FetchError | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [tickerInput, setTickerInput] = useState<string>("NHY");
  const [period, setPeriod] = useState<string>("1y");
  const [interval, setInterval] = useState<string>("1d");
  const [selectedDataPoints, setSelectedDataPoints] = useState<string[]>(DATA_POINT_OPTIONS);
  const [marketDataState, setMarketDataState] = useState<LoadState>("idle");
  const [marketDataError, setMarketDataError] = useState<FetchError | null>(null);
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeKey>("156w");
  const [visibleStrategies, setVisibleStrategies] = useState<StrategyVisibility>({
    strategy: true,
    benchmark: true,
  });

  const runBacktest = async (payload: BacktestRequestPayload) => {
    setBacktestState("loading");
    setError(null);
    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Failed to run backtest (${response.status})`);
      }
      const json: BacktestResult = await response.json();
      setResult(json);
      setBacktestState("success");
    } catch (err) {
      setBacktestState("error");
      setError({ message: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  useEffect(() => {
    const ticker = backtestTicker.trim();
    if (!ticker) {
      return;
    }
    try {
      const { startDate, endDate } = parseBacktestRange(backtestRange);
      runBacktest({
        ticker: ticker.toUpperCase(),
        startDate,
        endDate,
        interval: BACKTEST_INTERVAL,
      });
    } catch (err) {
      setBacktestState("error");
      setError({ message: err instanceof Error ? err.message : "Invalid date range" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDataPoint = (point: string) => {
    setSelectedDataPoints((prev) => {
      if (prev.includes(point)) {
        return prev.filter((item) => item !== point);
      }
      return [...prev, point];
    });
  };

  const requestMarketData = async () => {
    const tickers = tickerInput
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (!tickers.length) {
      setMarketDataState("error");
      setMarketDataError({ message: "Please provide at least one ticker symbol." });
      return;
    }

    if (!selectedDataPoints.length) {
      setMarketDataState("error");
      setMarketDataError({ message: "Select at least one data point to request." });
      return;
    }

    setMarketDataState("loading");
    setMarketDataError(null);

    try {
      const payload: MarketDataRequestPayload = {
        tickers,
        period,
        interval,
        dataPoints: selectedDataPoints,
      };
      const response = await fetch("/api/market-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch market data (${response.status})`);
      }
      const json: MarketDataResponse = await response.json();
      setMarketData(json);
      setMarketDataState("success");
    } catch (err) {
      setMarketData(null);
      setMarketDataState("error");
      setMarketDataError({ message: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  useEffect(() => {
    if (result?.symbol) {
      setVisibleStrategies({ strategy: true, benchmark: true });
      setDateRange("156w");
    }
  }, [result?.symbol]);

  const isLoading = backtestState === "loading";

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
    const firstPrice = result.priceHistory[0]?.AdjClose ?? 0;
    if (!initialEquity || !firstPrice) {
      return [];
    }
    return result.priceHistory.map((bar) => ({
      Date: bar.Date,
      Equity: roundToTwoDecimals((bar.AdjClose / firstPrice) * initialEquity),
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
    const inRangeDates = new Set(filteredPriceHistory.map((bar) => bar.Date));
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
          <h2>Request market data</h2>
          <form
            className="stacked-form"
            onSubmit={(event) => {
              event.preventDefault();
              requestMarketData();
            }}
          >
            <label htmlFor="tickers">Tickers</label>
            <input
              id="tickers"
              type="text"
              value={tickerInput}
              onChange={(event) => setTickerInput(event.target.value)}
              placeholder="AAPL, MSFT"
            />
            <label htmlFor="period">Period</label>
            <select
              id="period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label htmlFor="interval">Frequency</label>
            <select
              id="interval"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            >
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <fieldset className="checkbox-group">
              <legend>Data points</legend>
              {DATA_POINT_OPTIONS.map((option) => (
                <label key={option}>
                  <input
                    type="checkbox"
                    checked={selectedDataPoints.includes(option)}
                    onChange={() => toggleDataPoint(option)}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
            <button type="submit" disabled={marketDataState === "loading"}>
              {marketDataState === "loading" ? "Requesting…" : "Fetch data"}
            </button>
          </form>
          {marketDataState === "error" && marketDataError && (
            <p className="error">{marketDataError.message}</p>
          )}
          {marketDataState === "loading" && <p>Submitting request…</p>}
          {marketDataState === "success" && marketData &&
            !Object.values(marketData.data).some((rows) => rows.length) && (
              <p>No data returned for the selected parameters.</p>
            )}
        </section>

        {marketData && marketDataState === "success" && (
          <section className="card">
            <h3>Market data results</h3>
            <div className="market-data-results">
              {Object.entries(marketData.data).map(([ticker, rows]) => (
                <div key={ticker} className="market-data-group">
                  <h4>{ticker}</h4>
                  {rows.length === 0 ? (
                    <p>No data returned for this ticker.</p>
                  ) : (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Timestamp</th>
                            {marketData.dataPoints.map((point) => (
                              <th key={point}>{point}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, 100).map((row) => (
                            <tr key={`${ticker}-${row.timestamp}`}>
                              <td>{row.timestamp}</td>
                              {marketData.dataPoints.map((point) => (
                                <td key={point}>{renderDataValue(row[point])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card">
          <h2>Run backtest</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const ticker = backtestTicker.trim();
              if (!ticker) {
                setBacktestState("error");
                setError({ message: "Please enter a ticker symbol." });
                return;
              }
              try {
                const { startDate, endDate } = parseBacktestRange(backtestRange);
                runBacktest({
                  ticker: ticker.toUpperCase(),
                  startDate,
                  endDate,
                  interval: BACKTEST_INTERVAL,
                });
              } catch (err) {
                setBacktestState("error");
                setError({
                  message:
                    err instanceof Error
                      ? err.message
                      : "Enter dates as YYYY-MM-DD to YYYY-MM-DD or a relative period like 1y.",
                });
              }
            }}
            className="stacked-form"
          >
            <label htmlFor="backtest-ticker">Ticker</label>
            <input
              id="backtest-ticker"
              type="text"
              value={backtestTicker}
              onChange={(event) => setBacktestTicker(event.target.value)}
              placeholder="NHY"
            />
            <label htmlFor="backtest-range">Range</label>
            <input
              id="backtest-range"
              type="text"
              value={backtestRange}
              onChange={(event) => setBacktestRange(event.target.value)}
              placeholder="2023-01-01 to 2023-12-31 or 1y"
            />
            <button
              type="submit"
              disabled={isLoading || !backtestTicker.trim() || !backtestRange.trim()}
            >
              {backtestState === "loading" ? "Running…" : "Run backtest"}
            </button>
          </form>
        </section>

        {error && backtestState === "error" && (
          <section className="card">
            <p className="error">{error.message}</p>
          </section>
        )}

        {backtestState === "loading" && (
          <section className="card">
            <p>Running backtest…</p>
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
