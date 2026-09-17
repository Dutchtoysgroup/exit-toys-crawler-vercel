"""Sitemap parser - haalt alle URLs op uit de EXIT Toys sitemaps."""

from __future__ import annotations

import logging

from bs4 import BeautifulSoup

from config import BASE_URL
from crawlers.base import BaseCrawler

logger = logging.getLogger(__name__)

# Sitemaps zijn enkele MB's en exittoys.nl serveert ze traag (spareparts ~35s), ruim
# boven de REQUEST_TIMEOUT die voor productpagina's geldt.
SITEMAP_TIMEOUT = 120

# Sitemaps zijn al per type gesorteerd
SITEMAP_MAP = {
    "products": f"{BASE_URL}/sitemap-products.xml",
    "pages": f"{BASE_URL}/sitemap-pages.xml",
    "faqs": f"{BASE_URL}/sitemap-faqs.xml",
    "blogs": f"{BASE_URL}/sitemap-blog.xml",
}

# Sinds ~19 aug 2026 staan de losse onderdelen niet meer in sitemap-products.xml maar in
# een eigen sitemap. Het zijn gewone productpagina's, dus ze gaan mee als "products".
# Zonder deze sitemap verdwenen alle ~1.500 onderdelen uit de marketplace-feed.
EXTRA_PRODUCT_SITEMAPS = [
    f"{BASE_URL}/sitemap-spareparts.xml",
]


class SitemapParser:
    """Parst alle sitemaps en retourneert URLs per categorie."""

    def __init__(self, crawler: BaseCrawler):
        self.crawler = crawler

    async def parse_all(self) -> dict[str, list[str]]:
        """Parse alle sitemaps en retourneer URLs per categorie.

        Returns:
            Dict met keys: products, faqs, blogs, pages
        """
        categorized = {}

        for category, sitemap_url in SITEMAP_MAP.items():
            logger.info(f"Ophalen sitemap: {sitemap_url}")
            xml = await self.crawler.fetch(sitemap_url, timeout=SITEMAP_TIMEOUT)
            if xml:
                urls = self._extract_urls(xml)
                categorized[category] = urls
                logger.info(f"  {category}: {len(urls)} URLs")
            else:
                categorized[category] = []
                logger.warning(f"  {category}: sitemap niet beschikbaar")

        for sitemap_url in EXTRA_PRODUCT_SITEMAPS:
            logger.info(f"Ophalen sitemap: {sitemap_url}")
            xml = await self.crawler.fetch(sitemap_url, timeout=SITEMAP_TIMEOUT)
            if xml:
                urls = self._extract_urls(xml)
                bekend = set(categorized["products"])
                nieuw = [u for u in urls if u not in bekend]
                categorized["products"].extend(nieuw)
                logger.info(f"  products (extra): {len(nieuw)} URLs")
            else:
                logger.warning(f"  {sitemap_url}: sitemap niet beschikbaar")

        total = sum(len(v) for v in categorized.values())
        logger.info(f"Totaal {total} URLs uit sitemaps")

        return categorized

    def _extract_urls(self, xml: str) -> list[str]:
        """Extract URLs uit sitemap XML."""
        soup = BeautifulSoup(xml, "lxml-xml")
        urls = []
        for loc in soup.find_all("loc"):
            # Alleen <url><loc>, niet de <image:loc> van productfoto's: die werden anders
            # als pagina gecrawld en faalden elke nacht (~5.500 "mislukt").
            if loc.parent is None or loc.parent.name != "url":
                continue
            url = loc.text.strip()
            if url.startswith(BASE_URL):
                urls.append(url)
        return list(set(urls))  # Dedupliceer
