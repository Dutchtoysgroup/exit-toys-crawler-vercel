"""Product crawler - haalt productpagina's op."""

from __future__ import annotations

import logging

from config import BATCH_SIZE, LOCALE_CONFIG
from crawlers.base import BaseCrawler
from parsers.product_parser import ProductParser
from utils.progress import ProgressTracker
from utils.state import CrawlState

logger = logging.getLogger(__name__)


class ProductCrawler:
    """Crawlt alle productpagina's."""

    def __init__(self, crawler: BaseCrawler, state: CrawlState):
        self.crawler = crawler
        self.state = state
        self.parser = ProductParser(
            in_stock_text=LOCALE_CONFIG.in_stock_text,
            out_of_stock_text=LOCALE_CONFIG.out_of_stock_text,
        )

    async def crawl_all(self, urls: list[str]) -> list[dict]:
        """Crawl alle product-URLs en retourneer parsed data."""
        pending = [u for u in urls if not self.state.is_completed(u)]
        logger.info(f"Producten: {len(pending)} te crawlen ({len(urls) - len(pending)} al voltooid)")

        if not pending:
            return self.state.get_results("products")

        progress = ProgressTracker(len(pending), "Producten")
        results = []

        for i in range(0, len(pending), BATCH_SIZE):
            batch = pending[i : i + BATCH_SIZE]
            html_map = await self.crawler.fetch_many(batch)

            for url in batch:
                html = html_map.get(url)
                if html:
                    try:
                        product = self.parser.parse(url, html)
                        if product:
                            results.append(product)
                            self.state.add_result("products", product)
                            progress.success()
                        else:
                            self.state.record_failure(url)
                            progress.fail()
                    except Exception as e:
                        logger.error(f"Parse fout voor {url}: {e}")
                        self.state.record_failure(url)
                        progress.fail()
                else:
                    self.state.record_failure(url)
                    progress.fail()

                self.state.mark_completed(url)

            # Checkpoint na elke batch
            self.state.save()

        logger.info(progress.summary())
        return self.state.get_results("products")
