from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

from engine import Signals, backtest_weekly


AVAILABLE_SYMBOLS: Dict[str, str] = {
    "NHY": "Norsk Hydro",
    "EQNR": "Equinor",
    "AKER": "Aker ASA",
}


def _symbol_seed(symbol: str) -> int:
    """Deterministic seed per symbol for reproducible mock data."""
    seeds = {"NHY": 11, "EQNR": 23, "AKER": 37}
    return seeds.get(symbol, 1)


def generate_price_history(symbol: str, periods: int = 156) -> pd.DataFrame:
    """
    Create a synthetic weekly OHLC dataset so the backtester can run without external data.
    """
    rng = np.random.default_rng(_symbol_seed(symbol))
    dates = pd.date_range(end=pd.Timestamp.today().normalize(), periods=periods, freq="W-FRI")

    base_price = {"NHY": 70.0, "EQNR": 300.0, "AKER": 800.0}.get(symbol, 100.0)
    drift = {"NHY": 0.0015, "EQNR": 0.001, "AKER": 0.0008}.get(symbol, 0.001)
    vol = 0.03

    log_returns = drift + vol * rng.standard_normal(periods)
    prices = base_price * np.exp(np.cumsum(log_returns))

    close = pd.Series(prices, index=dates, name="Close")
    open_ = close.shift(1).fillna(close.iloc[0]) * (1 + 0.002 * rng.standard_normal(periods))
    high = np.maximum(open_, close) * (1 + 0.01 * rng.random(periods))
    low = np.minimum(open_, close) * (1 - 0.01 * rng.random(periods))

    df = pd.DataFrame(
        {
            "Open": open_,
            "High": high,
            "Low": low,
            "Close": close,
            "AdjClose": close,
        },
        index=dates,
    )
    df["NextOpen"] = df["Open"].shift(-1)
    return df


def generate_signals(price_df: pd.DataFrame) -> Signals:
    """
    Simple SMA crossover strategy to feed the engine backtester.
    """
    fast = price_df["AdjClose"].rolling(5, min_periods=1).mean()
    slow = price_df["AdjClose"].rolling(15, min_periods=1).mean()

    fast_prev = fast.shift(1)
    slow_prev = slow.shift(1)

    long_entry = (fast > slow) & (fast_prev <= slow_prev)
    long_exit = (fast < slow) & (fast_prev >= slow_prev)

    empty = pd.Series(False, index=price_df.index)

    return Signals(
        long_entry=long_entry.fillna(False),
        short_entry=empty,
        long_exit=long_exit.fillna(False),
        short_exit=empty,
    )


def backtest_symbol(symbol: str) -> Dict[str, object]:
    if symbol not in AVAILABLE_SYMBOLS:
        raise ValueError(f"Unsupported symbol: {symbol}")

    price_df = generate_price_history(symbol)
    signals = generate_signals(price_df)
    results = backtest_weekly(price_df, signals, allow_shorts=False, label=AVAILABLE_SYMBOLS[symbol])

    curve = results["equity_curve"].reset_index()
    curve["Date"] = curve["Date"].dt.strftime("%Y-%m-%d")

    final_equity = float(curve["Equity"].iloc[-1])
    initial_equity = float(curve["Equity"].iloc[0])
    total_return = (final_equity - initial_equity) / initial_equity if initial_equity else 0.0

    trades_payload: List[Dict[str, object]] = []
    for trade in results["trades"]:
        trades_payload.append(
            {
                "entry_date": trade.entry_index.strftime("%Y-%m-%d") if isinstance(trade.entry_index, datetime) else str(trade.entry_index),
                "exit_date": trade.exit_index.strftime("%Y-%m-%d") if isinstance(trade.exit_index, datetime) else str(trade.exit_index),
                "entry_price": round(float(trade.entry_price), 2),
                "exit_price": round(float(trade.exit_price), 2),
                "shares": round(float(trade.shares), 4),
                "pnl": round(float(trade.pnl), 2),
                "return_pct": round(float(trade.return_pct) * 100, 2),
            }
        )

    wins = sum(1 for trade in trades_payload if trade["pnl"] > 0)
    trade_count = len(trades_payload)
    win_rate = wins / trade_count if trade_count else 0.0

    return {
        "symbol": symbol,
        "name": AVAILABLE_SYMBOLS[symbol],
        "summary": {
            "initial_equity": round(initial_equity, 2),
            "final_equity": round(final_equity, 2),
            "total_return_pct": round(total_return * 100, 2),
            "trade_count": trade_count,
            "win_rate_pct": round(win_rate * 100, 2),
        },
        "equity_curve": curve.to_dict(orient="records"),
        "trades": trades_payload,
    }
