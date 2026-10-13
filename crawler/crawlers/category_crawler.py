"""Category crawler - ontdek extra product-URLs vanuit categoriepagina's."""

from __future__ import annotations

import logging
import re

from bs4 import BeautifulSoup

from config import BASE_URL, CATEGORY_PAGES
from crawlers.base import BaseCrawler

logger = logging.getLogger(__name__)


class CategoryCrawler:
    """Crawlt categoriepagina's om extra product-URLs te ontdekken."""

    def __init__(self, crawler: BaseCrawler, state):
        self.crawler = crawler
        self.state = state

    async def discover_products(self, known_urls: set[str]) -> list[str]:
        """Ontdek product-URLs vanuit categoriepagina's.

        Crawlt alle pagina's van elke categorie (paginering via ?p=N).
        """
        new_urls = set()

        for category_path in CATEGORY_PAGES:
            page = 1
            while True:
                url = f"{BASE_URL}{category_path}" + (f"?p={page}" if page > 1 else "")
                logger.info(f"Categorie crawlen: {url}")

                html = await self.crawler.fetch(url)
                if not html:
                    self.state.record_failure(url)
                    break

                product_urls = self._extract_product_urls(html)
                if not product_urls:
                    break

                for pu in product_urls:
                    if pu not in known_urls:
                        new_urls.add(pu)

                # Check of er een volgende pagina is
                if not self._has_next_page(html, page):
                    break

                page += 1

        logger.info(f"Category discovery: {len(new_urls)} nieuwe product-URLs gevonden")
        return list(new_urls)

    def _extract_product_urls(self, html: str) -> list[str]:
        """Extract product-URLs uit een categoriepagina."""
        soup = BeautifulSoup(html, "lxml")
        urls = set()

        # Product links: typisch /exit-<naam>-<artikelnr> patroon
        for a in soup.find_all("a", href=True):
            href = a["href"]
            # Producten op exittoys.nl: /exit-<naam>-NN-NN-NN-NN
            if re.search(r"/exit-.*\d{2}-\d{2}-\d{2}-\d{2}", href):
                full_url = href if href.startswith("http") else f"{BASE_URL}{href}"
                full_url = full_url.split("?")[0].split("#")[0]
                if full_url.startswith(BASE_URL):
                    urls.add(full_url)

        # Product links via data-attributen (object divs op categoriepagina's)
        for div in soup.select("[data-ecommerce='true']"):
            name = div.get("data-name", "")
            sku = div.get("data-id", "")
            if name and sku:
                # Zoek de bijbehorende link
                link = div.find("a", href=True)
                if link:
                    href = link["href"]
                    full_url = href if href.startswith("http") else f"{BASE_URL}{href}"
                    full_url = full_url.split("?")[0]
                    urls.add(full_url)

        return list(urls)

    def _has_next_page(self, html: str, current_page: int) -> bool:
        """Check of er een volgende pagina bestaat."""
        soup = BeautifulSoup(html, "lxml")

        next_page = current_page + 1

        # Zoek paginering links
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if f"p={next_page}" in href or f"page={next_page}" in href:
                return True

        # Check voor 'next' of 'volgende' link
        for a in soup.find_all("a", href=True):
            text = a.get_text(strip=True).lower()
            if text in ("volgende", "next", "→", "»"):
                return True

        return False
