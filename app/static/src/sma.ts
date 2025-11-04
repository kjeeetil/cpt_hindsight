export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  nextOpen: number | null;
}

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

const SYMBOL_METADATA: Record<string, { name: string; basePrice: number; drift: number }> = {
  NHY: { name: "Norsk Hydro", basePrice: 70, drift: 0.0015 },
  EQNR: { name: "Equinor", basePrice: 300, drift: 0.001 },
  AKER: { name: "Aker ASA", basePrice: 800, drift: 0.0008 },
};

const INITIAL_EQUITY = 100_000;
const FAST_LENGTH = 5;
const SLOW_LENGTH = 15;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function seedForSymbol(symbol: string): number {
  const seeds: Record<string, number> = { NHY: 11, EQNR: 23, AKER: 37 };
  return seeds[symbol] ?? 1;
}

export function generatePriceHistory(symbol: string, periods = 156): PriceBar[] {
  const meta = SYMBOL_METADATA[symbol] ?? { name: symbol, basePrice: 100, drift: 0.001 };
  const rng = mulberry32(seedForSymbol(symbol));
  const vol = 0.03;
  const today = new Date();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  const prices: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < periods; i += 1) {
    const logReturn = meta.drift + vol * randomNormal(rng);
    cumulative += logReturn;
    prices.push(meta.basePrice * Math.exp(cumulative));
  }

  const result: PriceBar[] = [];
  for (let i = 0; i < periods; i += 1) {
    const date = new Date(today.getTime() - (periods - i) * oneWeek);
    const close = prices[i];
    const prevClose = i > 0 ? prices[i - 1] : close;
    const open = prevClose * (1 + 0.002 * randomNormal(rng));
    const high = Math.max(open, close) * (1 + 0.01 * rng());
    const low = Math.min(open, close) * (1 - 0.01 * rng());
    const nextOpen = i + 1 < periods ? prices[i + 1] * (1 + 0.001 * randomNormal(rng)) : null;
    result.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      adjClose: close,
      nextOpen,
    });
  }
  return result;
}

function simpleMovingAverage(series: number[], index: number, period: number): number {
  const start = Math.max(0, index - period + 1);
  const subset = series.slice(start, index + 1);
  const sum = subset.reduce((acc, value) => acc + value, 0);
  return subset.length ? sum / subset.length : series[index];
}

function formatNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

export function runSmaBacktest(symbol: string): BacktestResult {
  const priceHistory = generatePriceHistory(symbol);
  const closes = priceHistory.map((bar) => bar.adjClose);

  let cash = INITIAL_EQUITY;
  let shares = 0;
  let entryPrice = 0;
  let entryDate = "";

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 0; i < priceHistory.length; i += 1) {
    const bar = priceHistory[i];
    const fast = simpleMovingAverage(closes, i, FAST_LENGTH);
    const slow = simpleMovingAverage(closes, i, SLOW_LENGTH);
    const prevFast = i > 0 ? simpleMovingAverage(closes, i - 1, FAST_LENGTH) : fast;
    const prevSlow = i > 0 ? simpleMovingAverage(closes, i - 1, SLOW_LENGTH) : slow;

    const havePosition = shares > 0;
    const crossoverUp = fast > slow && prevFast <= prevSlow;
    const crossoverDown = fast < slow && prevFast >= prevSlow;

    if (!havePosition && crossoverUp && bar.nextOpen) {
      const investableCash = cash * 0.95; // keep small buffer
      shares = Math.max(Math.floor(investableCash / bar.nextOpen), 0);
      if (shares > 0) {
        cash -= shares * bar.nextOpen;
        entryPrice = bar.nextOpen;
        entryDate = bar.date;
      }
    } else if (havePosition && (crossoverDown || bar.nextOpen === null)) {
      const exitPrice = bar.nextOpen ?? bar.close;
      const proceeds = shares * exitPrice;
      const cost = shares * entryPrice;
      const pnl = proceeds - cost;
      cash += proceeds;
      trades.push({
        entryDate,
        exitDate: bar.date,
        entryPrice: formatNumber(entryPrice),
        exitPrice: formatNumber(exitPrice),
        shares,
        pnl: formatNumber(pnl),
        returnPct: formatNumber(cost > 0 ? (pnl / cost) * 100 : 0),
      });
      shares = 0;
      entryPrice = 0;
    }

    const markToMarket = cash + shares * bar.close;
    equityCurve.push({ Date: bar.date, Equity: formatNumber(markToMarket) });
  }

  const initialEquity = equityCurve[0]?.Equity ?? INITIAL_EQUITY;
  const finalEquity = equityCurve[equityCurve.length - 1]?.Equity ?? initialEquity;
  const totalReturn = initialEquity ? ((finalEquity - initialEquity) / initialEquity) * 100 : 0;
  const wins = trades.filter((trade) => trade.pnl > 0).length;

  const metadata = SYMBOL_METADATA[symbol] ?? { name: symbol, basePrice: 100, drift: 0.001 };

  return {
    symbol,
    name: metadata.name,
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
