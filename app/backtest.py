"""Server-side SMA backtest helpers."""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any, Dict, List

import pandas as pd
import yfinance as yf

INITIAL_EQUITY: float = 100_000.0
FAST_LENGTH = 5
SLOW_LENGTH = 15


def _round(value: float) -> float:
    return round(float(value), 2)


def _format_date(value: Any) -> str:
    if isinstance(value, pd.Timestamp):
        try:
            value = value.tz_localize(None)
        except TypeError:
            pass
        return value.date().isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _download_history(ticker: str, start_date: date, end_date: date, interval: str) -> pd.DataFrame:
    try:
        frame = yf.download(
            tickers=ticker,
            start=start_date.isoformat(),
            end=(end_date + timedelta(days=1)).isoformat(),
            interval=interval,
            auto_adjust=False,
            threads=False,
            progress=False,
        )
    except Exception as exc:  # pragma: no cover - defensive against upstream errors
        raise RuntimeError("Failed to retrieve price data from upstream provider.") from exc

    if frame.empty:
        raise ValueError("No price data returned for the requested range.")

    if isinstance(frame.columns, pd.MultiIndex):
        try:
            frame = frame.xs(ticker, axis=1, level=0, drop_level=True)
        except KeyError as exc:
            raise ValueError(f"Price data for {ticker} was not returned.") from exc

    frame = frame.rename(columns={"Adj Close": "AdjClose"})

    required_columns = {"Open", "High", "Low", "Close", "AdjClose"}
    missing = required_columns - set(frame.columns)
    if missing:
        raise ValueError("Downloaded data did not contain required OHLCV columns.")

    frame = frame.sort_index()
    frame = frame.dropna(subset=["Open", "High", "Low", "Close", "AdjClose"])
    if frame.empty:
        raise ValueError("Downloaded data did not include usable price rows.")

    if "Volume" not in frame.columns:
        frame["Volume"] = 0.0
    else:
        frame["Volume"] = frame["Volume"].fillna(0.0)

    frame["NextOpen"] = frame["Open"].shift(-1)
    return frame


def _build_price_history(frame: pd.DataFrame) -> List[Dict[str, Any]]:
    history: List[Dict[str, Any]] = []
    for index, row in frame.iterrows():
        next_open = row.get("NextOpen")
        history.append(
            {
                "Date": _format_date(index),
                "Open": _round(row["Open"]),
                "High": _round(row["High"]),
                "Low": _round(row["Low"]),
                "Close": _round(row["Close"]),
                "AdjClose": _round(row["AdjClose"]),
                "Volume": int(round(float(row["Volume"]))),
                "NextOpen": None if pd.isna(next_open) else _round(next_open),
            }
        )
    return history


def _simple_moving_average(series: List[float], index: int, period: int) -> float:
    if index < 0:
        raise ValueError("Index must be non-negative.")
    start = max(0, index - period + 1)
    subset = series[start : index + 1]
    if not subset:
        return series[index]
    return sum(subset) / len(subset)


def run_backtest(ticker: str, start_date: date, end_date: date, interval: str) -> Dict[str, Any]:
    frame = _download_history(ticker, start_date, end_date, interval)

    price_history = _build_price_history(frame)
    dates = [entry["Date"] for entry in price_history]
    closes = frame["Close"].tolist()
    adj_closes = frame["AdjClose"].tolist()
    opens = frame["Open"].tolist()

    cash = INITIAL_EQUITY
    shares = 0
    entry_price = 0.0
    entry_date = ""
    pending_order: Dict[str, Any] | None = None

    trades: List[Dict[str, Any]] = []
    equity_curve: List[Dict[str, Any]] = []

    for index, current_date in enumerate(dates):
        bar_close = closes[index]

        if pending_order and pending_order["date"] == current_date:
            if pending_order["type"] == "buy":
                cost = pending_order["shares"] * pending_order["price"]
                cash -= cost
                shares += pending_order["shares"]
                entry_price = pending_order["price"]
                entry_date = pending_order["date"]
            else:
                exit_price = pending_order["price"]
                proceeds = pending_order["shares"] * exit_price
                cost_basis = pending_order["shares"] * entry_price
                pnl = proceeds - cost_basis
                cash += proceeds
                trades.append(
                    {
                        "entryDate": entry_date,
                        "exitDate": pending_order["date"],
                        "entryPrice": _round(entry_price),
                        "exitPrice": _round(exit_price),
                        "shares": pending_order["shares"],
                        "pnl": _round(pnl),
                        "returnPct": _round((pnl / cost_basis) * 100) if cost_basis else 0.0,
                    }
                )
                shares = 0
                entry_price = 0.0
                entry_date = ""
            pending_order = None

        fast = _simple_moving_average(adj_closes, index, FAST_LENGTH)
        slow = _simple_moving_average(adj_closes, index, SLOW_LENGTH)
        prev_fast = (
            _simple_moving_average(adj_closes, index - 1, FAST_LENGTH)
            if index > 0
            else fast
        )
        prev_slow = (
            _simple_moving_average(adj_closes, index - 1, SLOW_LENGTH)
            if index > 0
            else slow
        )

        have_position = shares > 0
        crossover_up = fast > slow and prev_fast <= prev_slow
        crossover_down = fast < slow and prev_fast >= prev_slow

        if not pending_order and index + 1 < len(dates):
            next_open_price = opens[index + 1]
            next_date = dates[index + 1]
            if not have_position and crossover_up:
                investable_cash = cash * 0.95
                planned_shares = max(int(math.floor(investable_cash / next_open_price)), 0)
                if planned_shares > 0:
                    pending_order = {
                        "type": "buy",
                        "date": next_date,
                        "price": next_open_price,
                        "shares": planned_shares,
                    }
            elif have_position and crossover_down:
                pending_order = {
                    "type": "sell",
                    "date": next_date,
                    "price": next_open_price,
                    "shares": shares,
                }

        mark_to_market = cash + shares * bar_close
        equity_curve.append({"Date": current_date, "Equity": _round(mark_to_market)})

    if shares > 0:
        final_close = closes[-1]
        proceeds = shares * final_close
        cost_basis = shares * entry_price
        pnl = proceeds - cost_basis
        cash += proceeds
        trades.append(
            {
                "entryDate": entry_date,
                "exitDate": dates[-1],
                "entryPrice": _round(entry_price),
                "exitPrice": _round(final_close),
                "shares": shares,
                "pnl": _round(pnl),
                "returnPct": _round((pnl / cost_basis) * 100) if cost_basis else 0.0,
            }
        )
        equity_curve[-1] = {"Date": dates[-1], "Equity": _round(cash)}
        shares = 0

    initial_equity = equity_curve[0]["Equity"] if equity_curve else INITIAL_EQUITY
    final_equity = equity_curve[-1]["Equity"] if equity_curve else initial_equity
    total_return_pct = ((final_equity - initial_equity) / initial_equity) * 100 if initial_equity else 0.0
    wins = sum(1 for trade in trades if trade["pnl"] > 0)

    summary = {
        "initialEquity": _round(initial_equity),
        "finalEquity": _round(final_equity),
        "totalReturnPct": _round(total_return_pct),
        "tradeCount": len(trades),
        "winRatePct": _round((wins / len(trades)) * 100) if trades else 0.0,
    }

    symbol = ticker.upper()

    return {
        "symbol": symbol,
        "name": symbol,
        "summary": summary,
        "equityCurve": equity_curve,
        "trades": trades,
        "priceHistory": price_history,
    }
