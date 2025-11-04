from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_symbols_endpoint_lists_available_symbols():
    response = client.get("/symbols")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert any(item["symbol"] == "NHY" for item in payload)
    assert all({"symbol", "name"}.issubset(item.keys()) for item in payload)


def test_health_endpoint_reports_ok():
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
