from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np
import pandas as pd


@dataclass
class Trade:
    entry_index: pd.Timestamp
    entry_price: float
    exit_index: pd.Timestamp
    exit_price: float
    shares: float
    pnl: float
    return_pct: float


@dataclass
class Signals:
    long_entry: pd.Series
    short_entry: pd.Series
    long_exit: pd.Series
    short_exit: pd.Series


INITIAL_EQUITY: float = 100_000.0
TARGET_ANNUAL_VOL: float = 0.20


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int) -> pd.Series:
    """Average True Range helper."""
    high_low = (high - low).abs()
    high_close = (high - close.shift(1)).abs()
    low_close = (low - close.shift(1)).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return tr.rolling(period, min_periods=1).mean()


def apply_cost(price: float, side: str) -> float:
    """Placeholder transaction cost model."""
    return float(price)


def backtest_weekly(
    w: pd.DataFrame,
    signals: Signals,
    trail_atr_mult: Optional[pd.Series] = None,
    label: str = "Strategy",
    macro_long: Optional[pd.Series] = None,
    macro_short: Optional[pd.Series] = None,
    allow_shorts: bool = True
) -> Dict:
    """Backtest one strategy on weekly data.
    Includes long/short logic, macro filters, and volatility targeting.
    """
    equity = INITIAL_EQUITY
    in_pos = False
    side = None  # 'long' or 'short'
    entry_px = np.nan
    entry_idx = None
    shares = 0.0

    atr14 = atr(w["High"], w["Low"], w["Close"], 14)

    trades: List[Trade] = []
    curve = []

    for i in range(len(w) - 1):
        idx = w.index[i]
        next_idx = w.index[i + 1]
        next_open = w.loc[idx, "NextOpen"]
        if pd.isna(next_open):
            curve.append((idx, equity))
            continue

        allow_long = True if macro_long is None else bool(macro_long.iloc[i])
        allow_short = True if macro_short is None else bool(macro_short.iloc[i])

        if not in_pos:
            if pd.isna(atr14.iloc[i]) or atr14.iloc[i] == 0:
                curve.append((idx, equity))
                continue
            shares_target = (equity * TARGET_ANNUAL_VOL) / (atr14.iloc[i] * math.sqrt(52))
            if signals.long_entry.iloc[i] and allow_long:
                px_buy = apply_cost(next_open, "buy")
                shares = min(shares_target, equity / px_buy)
                entry_px = px_buy
                entry_idx = next_idx
                equity -= shares * entry_px
                side = 'long'
                in_pos = True
            elif allow_shorts and signals.short_entry.iloc[i] and allow_short:
                px_sell = apply_cost(next_open, "sell")
                shares = min(shares_target, equity / px_sell)
                proceeds = shares * px_sell
                equity += proceeds
                entry_px = px_sell
                entry_idx = next_idx
                side = 'short'
                in_pos = True
        else:
            exit_flag = False
            if trail_atr_mult is not None and not pd.isna(trail_atr_mult.iloc[i]):
                trail = (w.loc[idx, "AdjClose"] - trail_atr_mult.iloc[i]) if side == 'long' else (w.loc[idx, "AdjClose"] + trail_atr_mult.iloc[i])
                if side == 'long' and w.loc[idx, "Low"] < trail:
                    exit_flag = True
                if side == 'short' and w.loc[idx, "High"] > trail:
                    exit_flag = True

            if side == 'long' and signals.long_exit.iloc[i]:
                exit_flag = True
            if side == 'short' and signals.short_exit.iloc[i]:
                exit_flag = True

            if side == 'long' and not allow_long:
                exit_flag = True
            if side == 'short' and not allow_short:
                exit_flag = True

            if exit_flag:
                if side == 'long':
                    px_sell = apply_cost(next_open, "sell")
                    proceeds = shares * px_sell
                    pnl = proceeds - (shares * entry_px)
                    ret = pnl / (shares * entry_px) if entry_px > 0 else 0.0
                    equity += proceeds
                    trades.append(Trade(entry_idx, entry_px, next_idx, px_sell, shares, pnl, ret))
                else:
                    px_buy = apply_cost(next_open, "buy")
                    cost = shares * px_buy
                    pnl = (shares * entry_px) - cost
                    ret = pnl / (shares * entry_px) if entry_px > 0 else 0.0
                    equity -= cost
                    trades.append(Trade(entry_idx, entry_px, next_idx, px_buy, shares, pnl, ret))
                in_pos = False
                side = None
                entry_px = np.nan
                entry_idx = None
                shares = 0.0

        mtm = equity
        if in_pos:
            if side == 'long':
                mtm += shares * w.loc[idx, "AdjClose"]
            else:
                mtm += (shares * entry_px) - (shares * w.loc[idx, "AdjClose"])
        curve.append((idx, mtm))

    if in_pos:
        last_idx = w.index[-2]
        final_open = w.loc[last_idx, "NextOpen"]
        if not pd.isna(final_open):
            if side == 'long':
                px_sell = apply_cost(final_open, "sell")
                proceeds = shares * px_sell
                pnl = proceeds - (shares * entry_px)
                equity += proceeds
                trades.append(Trade(entry_idx, entry_px, w.index[-1], px_sell, shares, pnl, pnl / (shares * entry_px)))
            else:
                px_buy = apply_cost(final_open, "buy")
                cost = shares * px_buy
                pnl = (shares * entry_px) - cost
                equity -= cost
                trades.append(Trade(entry_idx, entry_px, w.index[-1], px_buy, shares, pnl, pnl / (shares * entry_px)))

    curve_df = pd.DataFrame(curve, columns=["Date", "Equity"]).set_index("Date")
    return {"label": label, "equity_curve": curve_df, "trades": trades}
