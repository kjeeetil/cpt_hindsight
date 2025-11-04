"""Utilities for retrieving market data from external providers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import pandas as pd
import yfinance as yf


@dataclass(frozen=True)
class MarketDataRequest:
    """Parameters describing a market data request."""

    tickers: Sequence[str]
    period: str
    interval: str
    data_points: Sequence[str]


VALID_DATA_POINTS = {
    "open": "Open",
    "high": "High",
    "low": "Low",
    "close": "Close",
    "adj close": "Adj Close",
    "adjclose": "Adj Close",
    "adj_close": "Adj Close",
    "volume": "Volume",
}


def _normalise_tickers(tickers: Iterable[str]) -> list[str]:
    normalised = []
    for ticker in tickers:
        stripped = ticker.strip().upper()
        if stripped:
            normalised.append(stripped)
    return normalised


def _normalise_data_points(points: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for point in points:
        key = point.strip().lower()
        if not key:
            continue
        if key not in VALID_DATA_POINTS:
            raise ValueError(f"Unsupported data point '{point}'.")
        column_name = VALID_DATA_POINTS[key]
        if column_name not in seen:
            seen.add(column_name)
            result.append(column_name)
    if not result:
        raise ValueError("At least one data point must be requested.")
    return result


def _serialise_dataframe(df: pd.DataFrame, data_points: Sequence[str]) -> list[dict[str, float | str]]:
    """Convert a pandas DataFrame into a JSON-serialisable structure."""

    if df.empty:
        return []

    trimmed = df.dropna(how="all")
    if trimmed.empty:
        return []

    ordered_columns = [column for column in data_points if column in trimmed.columns]
    if not ordered_columns:
        return []

    trimmed = trimmed[ordered_columns]
    index = trimmed.index
    if isinstance(index, pd.DatetimeIndex):
        index = index.tz_localize(None)
    payload = []
    for ts, values in trimmed.iterrows():
        entry: dict[str, float | str] = {"timestamp": ts.isoformat() if hasattr(ts, "isoformat") else str(ts)}
        for column in ordered_columns:
            value = values[column]
            if pd.isna(value):
                continue
            entry[column] = float(value)
        payload.append(entry)
    return payload


def fetch_market_data(request: MarketDataRequest) -> dict[str, list[dict[str, float | str]]]:
    """Retrieve market data for the given request via yfinance."""

    tickers = _normalise_tickers(request.tickers)
    if not tickers:
        raise ValueError("At least one ticker must be provided.")

    data_points = _normalise_data_points(request.data_points)

    try:
        raw_df = yf.download(
            tickers=" ".join(tickers),
            period=request.period,
            interval=request.interval,
            auto_adjust=False,
            threads=False,
            progress=False,
        )
    except Exception as exc:  # pragma: no cover - network/third-party errors
        raise RuntimeError("Failed to retrieve data from upstream provider.") from exc

    if raw_df.empty:
        raise ValueError("No data returned for the requested parameters.")

    dataset: dict[str, list[dict[str, float | str]]] = {}

    if isinstance(raw_df.columns, pd.MultiIndex):
        level0 = raw_df.columns.get_level_values(0)
        level1 = raw_df.columns.get_level_values(1)
        for ticker in tickers:
            ticker_df: pd.DataFrame | None = None
            if ticker in level0:
                ticker_df = raw_df.xs(ticker, axis=1, level=0, drop_level=True)
            elif ticker in level1:
                ticker_df = raw_df.xs(ticker, axis=1, level=1, drop_level=True)
            if ticker_df is None:
                continue
            dataset[ticker] = _serialise_dataframe(ticker_df, data_points)
    else:
        dataset[tickers[0]] = _serialise_dataframe(raw_df, data_points)

    if not any(dataset.values()):
        raise ValueError("Data was retrieved but contained no usable points.")

    return dataset
