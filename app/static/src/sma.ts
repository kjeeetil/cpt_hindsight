export interface PriceBar {
  Date: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  AdjClose: number;
  Volume: number;
  NextOpen: number | null;
}

type RawPriceRow = Record<string, string | number | null | undefined>;

export interface Trade {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  returnPct: number;
}

export interface EquityPoint {
  Date: string;
  Equity: number;
}

export interface BacktestSummary {
  initialEquity: number;
  finalEquity: number;
  totalReturnPct: number;
  tradeCount: number;
  winRatePct: number;
}

export interface BacktestResult {
  symbol: string;
  name: string;
  summary: BacktestSummary;
  equityCurve: EquityPoint[];
  trades: Trade[];
  priceHistory: PriceBar[];
}

const INITIAL_EQUITY = 100_000;
const FAST_LENGTH = 5;
const SLOW_LENGTH = 15;

function simpleMovingAverage(series: number[], index: number, period: number): number {
  const start = Math.max(0, index - period + 1);
  const subset = series.slice(start, index + 1);
  const sum = subset.reduce((acc, value) => acc + value, 0);
  return subset.length ? sum / subset.length : series[index];
}

function formatNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

const normalizeDate = (value: unknown): string => {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return normalized;
    }
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  throw new Error(`Invalid timestamp value: ${String(value)}`);
};

const normalizeNumber = (value: unknown, field: string): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Missing numeric value for ${field}`);
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Invalid numeric value for ${field}`);
};

const normalizeRow = (row: RawPriceRow): Omit<PriceBar, "NextOpen"> => {
  const date = normalizeDate(row.Date ?? row.date ?? row.timestamp ?? row.Timestamp ?? null);
  return {
    Date: date,
    Open: normalizeNumber(row.Open ?? row.open, "Open"),
    High: normalizeNumber(row.High ?? row.high, "High"),
    Low: normalizeNumber(row.Low ?? row.low, "Low"),
    Close: normalizeNumber(row.Close ?? row.close, "Close"),
    AdjClose: normalizeNumber(row["Adj Close"] ?? row.adjClose ?? row.AdjClose, "Adj Close"),
    Volume: normalizeNumber(row.Volume ?? row.volume ?? 0, "Volume"),
  };
};

type PriceHistoryResponse = {
  symbol: string;
  name: string;
  history: RawPriceRow[];
};

type PendingOrder =
  | { type: "buy"; date: string; price: number; shares: number }
  | { type: "sell"; date: string; price: number; shares: number };

async function fetchPriceHistory(symbol: string): Promise<{ name: string; history: PriceBar[] }> {
  const response = await fetch(`/api/ohlcv/${encodeURIComponent(symbol)}`);
  if (!response.ok) {
    throw new Error(`Failed to download price history (${response.status})`);
  }
  const payload = (await response.json()) as PriceHistoryResponse;
  const normalized = payload.history
    .map((row) => normalizeRow(row))
    .sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
  const history: PriceBar[] = normalized.map((row, index) => ({
    ...row,
    NextOpen: index + 1 < normalized.length ? normalized[index + 1].Open : null,
  }));
  return { name: payload.name, history };
}

export async function runSmaBacktest(symbol: string): Promise<BacktestResult> {
  const { history: priceHistory, name } = await fetchPriceHistory(symbol);
  const closes = priceHistory.map((bar) => bar.AdjClose);

  let cash = INITIAL_EQUITY;
  let shares = 0;
  let entryPrice = 0;
  let entryDate = "";

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];
  let pendingOrder: PendingOrder | null = null;

  for (let i = 0; i < priceHistory.length; i += 1) {
    const bar = priceHistory[i];
    if (pendingOrder && pendingOrder.date === bar.Date) {
      if (pendingOrder.type === "buy") {
        const cost = pendingOrder.shares * pendingOrder.price;
        cash -= cost;
        shares += pendingOrder.shares;
        entryPrice = pendingOrder.price;
        entryDate = pendingOrder.date;
      } else {
        const exitPrice = pendingOrder.price;
        const proceeds = pendingOrder.shares * exitPrice;
        const costBasis = pendingOrder.shares * entryPrice;
        const pnl = proceeds - costBasis;
        cash += proceeds;
        trades.push({
          entryDate,
          exitDate: pendingOrder.date,
          entryPrice: formatNumber(entryPrice),
          exitPrice: formatNumber(exitPrice),
          shares: pendingOrder.shares,
          pnl: formatNumber(pnl),
          returnPct: formatNumber(costBasis > 0 ? (pnl / costBasis) * 100 : 0),
        });
        shares = Math.max(shares - pendingOrder.shares, 0);
        entryPrice = 0;
        entryDate = "";
      }
      pendingOrder = null;
    }
    const nextBar = priceHistory[i + 1];
    const fast = simpleMovingAverage(closes, i, FAST_LENGTH);
    const slow = simpleMovingAverage(closes, i, SLOW_LENGTH);
    const prevFast = i > 0 ? simpleMovingAverage(closes, i - 1, FAST_LENGTH) : fast;
    const prevSlow = i > 0 ? simpleMovingAverage(closes, i - 1, SLOW_LENGTH) : slow;

    const havePosition = shares > 0;
    const crossoverUp = fast > slow && prevFast <= prevSlow;
    const crossoverDown = fast < slow && prevFast >= prevSlow;

    if (!pendingOrder && nextBar) {
      if (!havePosition && crossoverUp) {
        const entryPriceCandidate = nextBar.Open;
        const investableCash = cash * 0.95; // keep small buffer
        const plannedShares = Math.max(Math.floor(investableCash / entryPriceCandidate), 0);
        if (plannedShares > 0) {
          pendingOrder = {
            type: "buy",
            date: nextBar.Date,
            price: entryPriceCandidate,
            shares: plannedShares,
          };
        }
      } else if (havePosition && crossoverDown) {
        pendingOrder = {
          type: "sell",
          date: nextBar.Date,
          price: nextBar.Open,
          shares,
        };
      }
    }

    const markToMarket = cash + shares * bar.Close;
    equityCurve.push({ Date: bar.Date, Equity: formatNumber(markToMarket) });
  }

  if (shares > 0) {
    const lastBar = priceHistory[priceHistory.length - 1];
    const exitPrice = lastBar.Close;
    const proceeds = shares * exitPrice;
    const cost = shares * entryPrice;
    const pnl = proceeds - cost;
    cash += proceeds;
    trades.push({
      entryDate,
      exitDate: lastBar.Date,
      entryPrice: formatNumber(entryPrice),
      exitPrice: formatNumber(exitPrice),
      shares,
      pnl: formatNumber(pnl),
      returnPct: formatNumber(cost > 0 ? (pnl / cost) * 100 : 0),
    });
    shares = 0;
    entryPrice = 0;
    entryDate = "";
    equityCurve[equityCurve.length - 1] = {
      Date: lastBar.Date,
      Equity: formatNumber(cash),
    };
  }

  const initialEquity = equityCurve[0]?.Equity ?? INITIAL_EQUITY;
  const finalEquity = equityCurve[equityCurve.length - 1]?.Equity ?? initialEquity;
  const totalReturn = initialEquity ? ((finalEquity - initialEquity) / initialEquity) * 100 : 0;
  const wins = trades.filter((trade) => trade.pnl > 0).length;

  return {
    symbol,
    name,
    summary: {
      initialEquity: formatNumber(initialEquity),
      finalEquity: formatNumber(finalEquity),
      totalReturnPct: formatNumber(totalReturn),
      tradeCount: trades.length,
      winRatePct: formatNumber(trades.length ? (wins / trades.length) * 100 : 0),
    },
    equityCurve,
    trades,
    priceHistory,
  };
}
