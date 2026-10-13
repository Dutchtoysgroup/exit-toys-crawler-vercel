"""FAQ crawler - haalt FAQ pagina's op."""

from __future__ import annotations

import logging

from config import BASE_URL, BATCH_SIZE, FAQ_INDEX_PATH, FAQ_INDEX_URL
from crawlers.base import BaseCrawler
from parsers.faq_parser import FAQParser
from utils.progress import ProgressTracker
from utils.state import CrawlState

logger = logging.getLogger(__name__)


class FAQCrawler:
    """Crawlt FAQ pagina's en individuele FAQ items."""

    def __init__(self, crawler: BaseCrawler, state: CrawlState):
        self.crawler = crawler
        self.state = state
        self.parser = FAQParser()

    async def discover_faq_urls(self, sitemap_urls: list[str]) -> list[str]:
        """Ontdek alle FAQ categorie-URLs.

        De sitemap bevat individuele FAQ URLs die 404 geven.
        We gebruiken alleen de categoriepagina's van de FAQ index,
        want die bevatten alle Q&A paren per categorie.
        """
        all_urls = set()

        # Categoriepagina's uit de FAQ index (enige werkende bron)
        html = await self.crawler.fetch(FAQ_INDEX_URL)
        if html:
            index_links = self.parser.parse_index(html)
            for link in index_links:
                full_url = link if link.startswith("http") else f"{BASE_URL}{link}"
                # Alleen echte FAQ categoriepagina's
                if f"{FAQ_INDEX_PATH}/" in full_url:
                    all_urls.add(full_url)
            logger.info(f"FAQ index: {len(all_urls)} categoriepagina's gevonden")

        if not all_urls:
            self.state.record_failure(FAQ_INDEX_URL)

        # Sitemap FAQ URLs worden genegeerd (geven 404)
        logger.info(f"FAQ totaal: {len(all_urls)} unieke URLs (sitemap URLs overgeslagen)")
        return list(all_urls)

    async def crawl_all(self, urls: list[str]) -> list[dict]:
        """Crawl alle FAQ URLs en retourneer parsed data."""
        pending = [u for u in urls if not self.state.is_completed(u)]
        logger.info(f"FAQs: {len(pending)} te crawlen ({len(urls) - len(pending)} al voltooid)")

        if not pending:
            return self.state.get_results("faqs")

        progress = ProgressTracker(len(pending), "FAQs")

        for i in range(0, len(pending), BATCH_SIZE):
            batch = pending[i : i + BATCH_SIZE]
            html_map = await self.crawler.fetch_many(batch)

            for url in batch:
                html = html_map.get(url)
                if html:
                    try:
                        faqs = self.parser.parse(url, html)
                        if faqs:
                            self.state.add_results("faqs", faqs)
                            progress.success()
                        else:
                            self.state.record_failure(url)
                            progress.fail()
                    except Exception as e:
                        logger.error(f"FAQ parse fout voor {url}: {e}")
                        self.state.record_failure(url)
                        progress.fail()
                else:
                    self.state.record_failure(url)
                    progress.fail()

                self.state.mark_completed(url)

            self.state.save()

        logger.info(progress.summary())
        return self.state.get_results("faqs")
