"""Open Food Facts integration with persistent food_cache.

Free, open, gigantic database — no API key. Docs: https://world.openfoodfacts.org/data
We cache lookups by (source, external_id) so repeated agent runs don't hammer
the public API.
"""
from __future__ import annotations
from typing import Any, Optional
import httpx
from ai.db import get_db

SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"

# Fields we ask OFF to return — keeps payload size manageable.
_FIELDS = "code,product_name,brands,nutriments,quantity"


def _normalize_per_100g(nutriments: dict[str, Any]) -> dict[str, float]:
    """Map OFF's verbose nutriment keys onto our canonical per_100g shape."""
    def f(k: str) -> float:
        v = nutriments.get(k)
        try:
            return float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            return 0.0
    return {
        "kcal":      f("energy-kcal_100g"),
        "protein_g": f("proteins_100g"),
        "carbs_g":   f("carbohydrates_100g"),
        "fat_g":     f("fat_100g"),
        "fiber_g":   f("fiber_100g"),
        "sugar_g":   f("sugars_100g"),
    }


def _cache_get(query: str) -> Optional[dict[str, Any]]:
    db = get_db()
    # Cache key is the lowercased query string, stored as external_id with source='off-search'.
    resp = db.table("food_cache").select("id, source, external_id, name, per_100g") \
        .eq("source", "off-search") \
        .eq("external_id", query.lower()) \
        .limit(1).execute()
    return resp.data[0] if resp.data else None


def _cache_put(query: str, *, name: str, per_100g: dict[str, float]) -> dict[str, Any]:
    db = get_db()
    row = {
        "source":      "off-search",
        "external_id": query.lower(),
        "name":        name,
        "per_100g":    per_100g,
    }
    resp = db.table("food_cache").upsert(row, on_conflict="source,external_id").execute()
    return resp.data[0] if resp.data else row


def search_openfoodfacts(query: str, *, page_size: int = 5) -> Optional[dict[str, Any]]:
    """Hit OFF search and return the top product with nutriments, or None."""
    r = httpx.get(SEARCH_URL, params={
        "search_terms": query,
        "search_simple": 1,
        "action": "process",
        "json": 1,
        "fields": _FIELDS,
        "page_size": page_size,
    }, timeout=10)
    r.raise_for_status()
    data = r.json()
    for product in data.get("products", []):
        nutri = product.get("nutriments") or {}
        # Require at least kcal — many OFF entries have no energy data.
        if nutri.get("energy-kcal_100g") is not None:
            return {
                "code": product.get("code"),
                "name": product.get("product_name") or query.title(),
                "brand": product.get("brands"),
                "per_100g": _normalize_per_100g(nutri),
            }
    return None


def lookup_food(query: str) -> Optional[dict[str, Any]]:
    """Cached food lookup. Returns {name, per_100g, source} or None if not found."""
    q = query.strip().lower()
    if not q:
        return None

    cached = _cache_get(q)
    if cached:
        return {
            "name":     cached["name"],
            "per_100g": cached["per_100g"],
            "source":   "cache",
        }

    hit = search_openfoodfacts(q)
    if hit is None:
        return None

    _cache_put(q, name=hit["name"], per_100g=hit["per_100g"])
    return {
        "name":     hit["name"],
        "per_100g": hit["per_100g"],
        "source":   "openfoodfacts",
    }
