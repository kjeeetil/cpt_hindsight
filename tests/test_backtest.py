from datetime import date

import pandas as pd
import pytest

from app.backtest import run_backtest


def test_run_backtest_returns_expected_payload(monkeypatch):
    dates = pd.date_range("2023-01-01", periods=20, freq="D")
    data = pd.DataFrame(
        {
            "Open": [100 + i for i in range(20)],
            "High": [101 + i for i in range(20)],
            "Low": [99 + i for i in range(20)],
            "Close": [100 + i for i in range(20)],
            "AdjClose": [100 + i for i in range(20)],
            "Volume": [1_000_000 for _ in range(20)],
        },
        index=dates,
    )

    def fake_download(*args, **kwargs):
        return data.copy()

    monkeypatch.setattr("app.backtest.yf.download", fake_download)

    result = run_backtest("TEST", date(2023, 1, 1), date(2023, 1, 20), "1d")

    assert result["symbol"] == "TEST"
    assert result["name"] == "TEST"
    summary = result["summary"]
    assert summary["initialEquity"] == pytest.approx(100_000.0)
    assert summary["finalEquity"] >= summary["initialEquity"]
    assert summary["tradeCount"] >= 0
    assert isinstance(result["priceHistory"], list)
    assert len(result["priceHistory"]) == len(data)
    assert isinstance(result["equityCurve"], list)
    assert len(result["equityCurve"]) == len(data)
