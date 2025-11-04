import pandas as pd
import pytest
from pathlib import Path

from engine import Signals, apply_cost, atr, backtest_weekly


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def test_atr_calculates_average_true_range():
    high = pd.Series([10.0, 12.0, 11.0])
    low = pd.Series([9.0, 10.0, 10.0])
    close = pd.Series([9.5, 11.0, 10.5])

    result = atr(high, low, close, period=2)

    assert pytest.approx(result.tolist()) == [1.0, 1.75, 1.75]


def test_apply_cost_returns_unmodified_price():
    assert apply_cost(101.23, "buy") == pytest.approx(101.23)
    assert apply_cost(88.5, "sell") == pytest.approx(88.5)


def test_backtest_weekly_matches_fixture_regression():
    prices = pd.read_csv(FIXTURES / "weekly_prices.csv", parse_dates=["Date"]).set_index("Date")
    signals_df = pd.read_csv(FIXTURES / "strategy_signals.csv", parse_dates=["Date"]).set_index("Date")
    expected_curve = pd.read_csv(FIXTURES / "expected_equity_curve.csv")
    expected_trades = pd.read_csv(FIXTURES / "expected_trades.csv")

    signals = Signals(
        long_entry=signals_df["long_entry"].astype(bool),
        short_entry=signals_df["short_entry"].astype(bool),
        long_exit=signals_df["long_exit"].astype(bool),
        short_exit=signals_df["short_exit"].astype(bool),
    )

    result = backtest_weekly(prices, signals, allow_shorts=False, label="Fixture Strategy")
    curve = result["equity_curve"].reset_index()
    curve["Date"] = curve["Date"].dt.strftime("%Y-%m-%d")
    curve["Equity"] = curve["Equity"].round(6)

    assert curve.to_dict(orient="records") == expected_curve.to_dict(orient="records")

    trades_payload = []
    for trade in result["trades"]:
        trades_payload.append(
            {
                "entry_index": trade.entry_index.strftime("%Y-%m-%d"),
                "entry_price": round(trade.entry_price, 2),
                "exit_index": trade.exit_index.strftime("%Y-%m-%d"),
                "exit_price": round(trade.exit_price, 2),
                "shares": round(trade.shares, 6),
                "pnl": round(trade.pnl, 6),
                "return_pct": round(trade.return_pct, 8),
            }
        )

    assert trades_payload == expected_trades.to_dict(orient="records")
