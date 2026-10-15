"""Blog crawler - haalt blogposts op."""

from __future__ import annotations

import logging

from config import BASE_URL, BATCH_SIZE, BLOG_INDEX_URL, LOCALE_CONFIG
from crawlers.base import BaseCrawler
from parsers.blog_parser import BlogParser
from utils.progress import ProgressTracker
from utils.state import CrawlState

logger = logging.getLogger(__name__)


class BlogCrawler:
    """Crawlt blog pagina's."""

    def __init__(self, crawler: BaseCrawler, state: CrawlState):
        self.crawler = crawler
        self.state = state
        self.parser = BlogParser(
            written_by_prefix=LOCALE_CONFIG.written_by_prefix,
        )

    async def discover_blog_urls(self, sitemap_urls: list[str]) -> list[str]:
        """Ontdek alle blog URLs.

        Combineert sitemap URLs met links van de blog index pagina.
        De blog index laadt alle posts in de DOM (inclusief hidden).
        """
        all_urls = set(sitemap_urls)

        # Blog index pagina crawlen voor extra URLs
        html = await self.crawler.fetch(BLOG_INDEX_URL)
        if html:
            index_urls = self.parser.parse_index(html)
            for link in index_urls:
                full_url = link if link.startswith("http") else f"{BASE_URL}{link}"
                all_urls.add(full_url)
            logger.info(f"Blog index: {len(index_urls)} posts gevonden")
        else:
            self.state.record_failure(BLOG_INDEX_URL)

        # Filter de index pagina zelf eruit
        all_urls.discard(BLOG_INDEX_URL)

        logger.info(f"Blog totaal: {len(all_urls)} unieke URLs")
        return list(all_urls)

    async def crawl_all(self, urls: list[str]) -> list[dict]:
        """Crawl alle blog URLs en retourneer parsed data."""
        pending = [u for u in urls if not self.state.is_completed(u)]
        logger.info(f"Blogs: {len(pending)} te crawlen ({len(urls) - len(pending)} al voltooid)")

        if not pending:
            return self.state.get_results("blogs")

        progress = ProgressTracker(len(pending), "Blogs")

        for i in range(0, len(pending), BATCH_SIZE):
            batch = pending[i : i + BATCH_SIZE]
            html_map = await self.crawler.fetch_many(batch)

            for url in batch:
                html = html_map.get(url)
                if html:
                    try:
                        blog = self.parser.parse(url, html)
                        if blog:
                            self.state.add_result("blogs", blog)
                            progress.success()
                        else:
                            # Pagina is wel opgehaald maar heeft een andere layout.
                            self.state.record_skip(url, "geen blog-inhoud herkend")
                            progress.skip()
                    except Exception as e:
                        logger.error(f"Blog parse fout voor {url}: {e}")
                        self.state.record_failure(url)
                        progress.fail()
                else:
                    self.state.record_failure(url)
                    progress.fail()

                self.state.mark_completed(url)

            self.state.save()

        logger.info(progress.summary())
        return self.state.get_results("blogs")
