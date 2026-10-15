"""Page crawler - haalt info- en categoriepagina's op."""

from __future__ import annotations

import logging

from config import BASE_URL, BATCH_SIZE, JOB_POSTING_KEYWORD, LOCALE_CONFIG, SKIP_PATHS
from crawlers.base import BaseCrawler
from parsers.page_parser import PageParser
from utils.progress import ProgressTracker
from utils.state import CrawlState

logger = logging.getLogger(__name__)


class PageCrawler:
    """Crawlt info- en categoriepagina's."""

    def __init__(self, crawler: BaseCrawler, state: CrawlState):
        self.crawler = crawler
        self.state = state
        self.parser = PageParser(
            skip_words=("zoeken", "search", "winkelwagen", "suchen", "warenkorb"),
        )

    def filter_urls(self, sitemap_pages: list[str]) -> list[str]:
        """Filter relevante pagina-URLs uit de sitemap."""
        filtered = []
        for url in sitemap_pages:
            path = url.replace(BASE_URL, "")

            # Skip ongewenste paden
            if path in SKIP_PATHS:
                continue

            # Skip pagina's die eigenlijk producten of blogs zijn
            if f"{LOCALE_CONFIG.blog_index_path}/" in path:
                continue

            # Skip vacatures
            if JOB_POSTING_KEYWORD and JOB_POSTING_KEYWORD in path:
                continue

            filtered.append(url)

        logger.info(f"Pagina's: {len(filtered)} van {len(sitemap_pages)} URLs na filtering")
        return filtered

    async def crawl_all(self, urls: list[str]) -> list[dict]:
        """Crawl alle pagina URLs en retourneer parsed data."""
        pending = [u for u in urls if not self.state.is_completed(u)]
        logger.info(f"Pagina's: {len(pending)} te crawlen ({len(urls) - len(pending)} al voltooid)")

        if not pending:
            return self.state.get_results("pages")

        progress = ProgressTracker(len(pending), "Pagina's")

        for i in range(0, len(pending), BATCH_SIZE):
            batch = pending[i : i + BATCH_SIZE]
            html_map = await self.crawler.fetch_many(batch)

            for url in batch:
                html = html_map.get(url)
                if html:
                    try:
                        page_data = self.parser.parse(url, html)
                        if page_data:
                            self.state.add_result("pages", page_data)
                            progress.success()
                        else:
                            # Pagina is wel opgehaald maar heeft een andere layout.
                            self.state.record_skip(url, "geen page-inhoud herkend")
                            progress.skip()
                    except Exception as e:
                        logger.error(f"Page parse fout voor {url}: {e}")
                        self.state.record_failure(url)
                        progress.fail()
                else:
                    self.state.record_failure(url)
                    progress.fail()

                self.state.mark_completed(url)

            self.state.save()

        logger.info(progress.summary())
        return self.state.get_results("pages")
