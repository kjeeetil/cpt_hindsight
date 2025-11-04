from fastapi.testclient import TestClient

from datetime import date

from app.main import app


client = TestClient(app)


def test_symbols_endpoint_lists_available_symbols():
    response = client.get("/api/symbols")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert any(item["symbol"] == "NHY" for item in payload)
    assert all({"symbol", "name"}.issubset(item.keys()) for item in payload)


def test_health_endpoint_reports_ok():
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_backtest_endpoint_invokes_strategy(monkeypatch):
    expected = {
        "symbol": "TEST",
        "name": "Test Corp",
        "summary": {
            "initialEquity": 100_000.0,
            "finalEquity": 110_000.0,
            "totalReturnPct": 10.0,
            "tradeCount": 1,
            "winRatePct": 100.0,
        },
        "equityCurve": [{"Date": "2023-01-01", "Equity": 100_000.0}],
        "trades": [],
        "priceHistory": [],
    }

    def fake_backtest(ticker: str, start: date, end: date, interval: str):
        assert ticker == "TEST"
        assert interval == "1d"
        assert start.isoformat() == "2023-01-01"
        assert end.isoformat() == "2023-01-31"
        return expected

    monkeypatch.setattr("app.main.execute_backtest", fake_backtest)

    response = client.post(
        "/api/backtest",
        json={
            "ticker": "test",
            "startDate": "2023-01-01",
            "endDate": "2023-01-31",
            "interval": "1d",
        },
    )

    assert response.status_code == 200
    assert response.json() == expected
