"""Parts crawler - gebruikt Playwright voor JavaScript-driven onderdelen sectie."""

from __future__ import annotations

import asyncio
import logging
import re

from config import BASE_URL, LOCALE_CONFIG, PARTS_BASE_URL
from parsers.product_parser import ProductParser

logger = logging.getLogger(__name__)


class PartsCrawler:
    """Crawlt de onderdelen-sectie met Playwright (JS-driven filters)."""

    def __init__(self, state):
        self.state = state
        self.parser = ProductParser(
            in_stock_text=LOCALE_CONFIG.in_stock_text,
            out_of_stock_text=LOCALE_CONFIG.out_of_stock_text,
        )
        self.parts_path = LOCALE_CONFIG.parts_path

    async def discover_and_crawl(self) -> list[dict]:
        """Ontdek onderdelen-URLs via Playwright en crawl ze."""
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            self.state.record_failure("parts:playwright-missing")
            logger.error(
                "Playwright niet geinstalleerd. Run: "
                "pip install playwright && playwright install chromium"
            )
            return []

        logger.info("Playwright starten voor onderdelen-sectie...")
        results = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                )
            )
            page = await context.new_page()

            try:
                # Navigeer naar onderdelen pagina
                response = await page.goto(PARTS_BASE_URL, wait_until="networkidle", timeout=30000)
                if not response or response.status >= 400:
                    raise RuntimeError("Onderdelen-index niet beschikbaar")
                await asyncio.sleep(2)

                product_urls = set()

                # Verzamel links van de hoofdpagina
                urls = await self._extract_product_urls(page)
                product_urls.update(urls)
                logger.info(f"Onderdelen hoofdpagina: {len(urls)} product-URLs")

                # Zoek en klik op filters/categorieën
                filter_links = await page.query_selector_all(
                    ".filter a, .submenu a, [class*='filter'] a, "
                    "[class*='category'] a, .categories a"
                )

                if filter_links:
                    logger.info(f"Onderdelen: {len(filter_links)} filter/categorie links gevonden")
                    for link in filter_links:
                        try:
                            href = await link.get_attribute("href")
                            if href and self.parts_path in href.lower():
                                nav_url = href if href.startswith("http") else f"{BASE_URL}{href}"
                                response = await page.goto(nav_url, wait_until="networkidle", timeout=15000)
                                if not response or response.status >= 400:
                                    self.state.record_failure(nav_url)
                                    continue
                                await asyncio.sleep(1)

                                # Scroll voor lazy loading
                                await self._scroll_page(page)

                                new_urls = await self._extract_product_urls(page)
                                product_urls.update(new_urls)
                        except Exception as e:
                            self.state.record_failure("parts:filter")
                            logger.debug(f"Filter navigatie fout: {e}")

                # Paginering proberen
                page_num = 1
                while True:
                    page_num += 1
                    next_url = f"{PARTS_BASE_URL}?p={page_num}"
                    try:
                        resp = await page.goto(next_url, wait_until="networkidle", timeout=15000)
                        if not resp or resp.status != 200:
                            # Een 404 is het normale einde van deze probe-paginering.
                            if not resp or resp.status != 404:
                                self.state.record_failure(next_url)
                            break
                        await asyncio.sleep(1)
                        new_urls = await self._extract_product_urls(page)
                        if not new_urls:
                            break
                        product_urls.update(new_urls)
                    except Exception:
                        self.state.record_failure(next_url)
                        break

                logger.info(f"Onderdelen totaal: {len(product_urls)} unieke URLs gevonden")

                # Crawl de gevonden URLs via de browser
                pending = [u for u in product_urls if not self.state.is_completed(u)]
                logger.info(f"Onderdelen: {len(pending)} te crawlen")

                for i, url in enumerate(pending):
                    try:
                        response = await page.goto(url, wait_until="networkidle", timeout=15000)
                        if not response or response.status >= 400:
                            raise RuntimeError("Onderdeelpagina niet beschikbaar")
                        html = await page.content()
                        product = self.parser.parse(url, html)
                        if product:
                            product["type"] = "onderdeel"
                            results.append(product)
                            self.state.add_result("parts", product)
                        else:
                            self.state.record_failure(url)
                        self.state.mark_completed(url)
                    except Exception as e:
                        self.state.record_failure(url)
                        logger.error(f"Onderdeel crawl fout {url}: {e}")
                        self.state.mark_completed(url)

                    if (i + 1) % 50 == 0:
                        self.state.save()
                        logger.info(f"Onderdelen voortgang: {i + 1}/{len(pending)}")

            except Exception as e:
                self.state.record_failure("parts:playwright")
                logger.error(f"Playwright fout: {e}")
            finally:
                await browser.close()

        self.state.save()
        logger.info(f"Onderdelen: {len(results)} producten gecrawld")
        return results

    async def _extract_product_urls(self, page) -> set[str]:
        """Extract product-URLs uit de huidige pagina."""
        urls = set()
        links = await page.query_selector_all("a[href]")
        for link in links:
            href = await link.get_attribute("href")
            if href and re.search(r"/exit-.*\d{2}-\d{2}-\d{2}-\d{2}", href):
                full_url = href if href.startswith("http") else f"{BASE_URL}{href}"
                full_url = full_url.split("?")[0].split("#")[0]
                if full_url.startswith(BASE_URL):
                    urls.add(full_url)
        return urls

    async def _scroll_page(self, page):
        """Scroll geleidelijk door de pagina voor lazy loading."""
        for _ in range(10):
            await page.evaluate("window.scrollBy(0, 500)")
            await asyncio.sleep(0.3)
