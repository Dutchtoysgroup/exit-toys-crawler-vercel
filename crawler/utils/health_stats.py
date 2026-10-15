"""Versioned healthcheck contract; no network or crawler dependencies."""

from datetime import datetime, timezone


def build_crawl_stats(state, locale: str, marketplace_entries: int) -> dict:
    results = state.all_results()
    products = results.get("products", [])
    discovered = len(state.get_discovered_urls("products"))
    complete = state.phase == "done" and state.error_count == 0 and len(products) == discovered
    return {
        "schema_version": 1,
        "locale": locale,
        "phase": state.phase,
        "crawl_status": "completed" if complete else "partial",
        "error_count": state.error_count,
        "failed_sources": state.failures,
        "skipped_count": len(state.skipped),
        "skipped_sources": state.skipped,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "product_urls": discovered,
        "products": len(products),
        "product_success_rate": round(len(products) / discovered, 4) if discovered else 0,
        "parts": sum(1 for p in products if (p.get("category") or "").strip().lower() in {"onderdelen", "ersatzteile"}),
        "additional_parts": len(results.get("parts", [])),
        "products_with_accessories": sum(1 for p in products if p.get("accessories")),
        "marketplace_entries": marketplace_entries,
        "faqs": len(results.get("faqs", [])),
        "pages": len(results.get("pages", [])),
        "blogs": len(results.get("blogs", [])),
    }
