"""Offline tests for the producer and the Python -> JS healthcheck contract."""

import asyncio
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from crawlers.blog_crawler import BlogCrawler
from crawlers.category_crawler import CategoryCrawler
from crawlers.faq_crawler import FAQCrawler
from crawlers.page_crawler import PageCrawler
from crawlers.product_crawler import ProductCrawler
from crawlers.sitemap_parser import SitemapParser
from utils.health_stats import build_crawl_stats
from utils.state import CrawlState


class HealthStatsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state_file = patch("utils.state.STATE_FILE", self.root / "state.json")
        self.state_file.start()
        self.addCleanup(self.state_file.stop)
        self.state = CrawlState()

    def fill_products(self, locale="nl"):
        self.state.set_discovered_urls("products", [f"product-{i}" for i in range(500)])
        self.state.add_results("products", [
            {"category": ("onderdelen" if locale == "nl" else "ersatzteile") if i < 100 else "sport"}
            for i in range(500)
        ])

    def evaluate_in_js(self, stats):
        result = subprocess.run([
            "node", "--input-type=module", "-e",
            'import fs from "node:fs"; import { evaluate } from "./scripts/lib/crawl-health-evaluation.mjs"; '
            'const stats = JSON.parse(fs.readFileSync(0, "utf8")); '
            'console.log(JSON.stringify(evaluate(stats, [], stats.locale)));',
        ], cwd=Path(__file__).resolve().parents[2], input=json.dumps(stats), text=True,
            capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_completed_stats_contract_for_both_countries(self):
        for locale in ("nl", "de"):
            with self.subTest(locale=locale):
                self.state.reset()
                self.fill_products(locale)
                self.state.set_phase("done")
                stats = build_crawl_stats(self.state, locale, 500)
                self.assertEqual(stats["crawl_status"], "completed")
                self.assertEqual(stats["parts"], 100)
                self.assertFalse(self.evaluate_in_js(stats)["block"])

    def test_unfinished_phase_and_missing_products_are_partial(self):
        self.fill_products()
        self.assertEqual(build_crawl_stats(self.state, "nl", 500)["crawl_status"], "partial")
        self.state.set_phase("done")
        self.state.get_results("products").pop()
        stats = build_crawl_stats(self.state, "nl", 499)
        self.assertEqual(stats["crawl_status"], "partial")
        self.assertTrue(self.evaluate_in_js(stats)["hardBlock"])

    def test_failures_survive_resume_and_reset_clears_them(self):
        self.state.record_failure("failed-url")
        self.state.record_failure("failed-url")
        self.state.mark_completed("failed-url")
        self.state.save()
        resumed = CrawlState()
        self.assertEqual(resumed.error_count, 1)
        resumed.reset()
        self.assertEqual(resumed.error_count, 0)

    def test_page_failures_are_not_hidden_by_mark_completed(self):
        for cls in (ProductCrawler, FAQCrawler, BlogCrawler, PageCrawler):
            for scenario in ("fetch", "empty", "parse", "missing-response"):
                with self.subTest(crawler=cls.__name__, scenario=scenario):
                    self.state.reset()
                    response = {} if scenario == "missing-response" else {"url": None if scenario == "fetch" else "html"}
                    crawler = cls(SimpleNamespace(fetch_many=AsyncMock(return_value=response)), self.state)
                    crawler.parser = Mock()
                    crawler.parser.parse.return_value = None
                    if scenario == "parse":
                        crawler.parser.parse.side_effect = ValueError("parse failed")
                    asyncio.run(crawler.crawl_all(["url"]))
                    skipped = scenario == "empty" and cls in (BlogCrawler, PageCrawler)
                    self.assertEqual(self.state.error_count, 0 if skipped else 1)
                    self.assertEqual(self.state.skipped, ["url"] if skipped else [])
                    self.assertTrue(self.state.is_completed("url"))

    def test_skipped_pages_keep_crawl_completed_but_stay_visible(self):
        self.fill_products()
        self.state.record_skip("https://example.test/andere-layout", "geen page-inhoud herkend")
        self.state.set_phase("done")
        self.state.save()
        self.assertEqual(CrawlState().skipped, ["https://example.test/andere-layout"])
        stats = build_crawl_stats(self.state, "nl", 500)
        self.assertEqual(stats["crawl_status"], "completed")
        self.assertEqual(stats["error_count"], 0)
        self.assertEqual(stats["skipped_count"], 1)
        self.assertEqual(stats["skipped_sources"], ["https://example.test/andere-layout"])
        self.assertFalse(self.evaluate_in_js(stats)["hardBlock"])

    def test_failed_sources_are_named_in_rejection(self):
        self.fill_products()
        self.state.record_failure("https://example.test/kapot")
        self.state.set_phase("done")
        stats = build_crawl_stats(self.state, "nl", 500)
        self.assertEqual(stats["failed_sources"], ["https://example.test/kapot"])
        result = self.evaluate_in_js(stats)
        self.assertTrue(result["hardBlock"])
        self.assertTrue(any("https://example.test/kapot" in problem for problem in result["problems"]))

    def test_successful_parse_does_not_record_failure(self):
        crawler = ProductCrawler(SimpleNamespace(fetch_many=AsyncMock(return_value={"url": "html"})), self.state)
        crawler.parser = Mock()
        crawler.parser.parse.return_value = {"category": "sport"}
        asyncio.run(crawler.crawl_all(["url"]))
        self.assertEqual(self.state.error_count, 0)
        self.assertEqual(len(self.state.get_results("products")), 1)

    def test_missing_or_empty_sitemap_records_failure(self):
        for response in (None, "<urlset/>"):
            with self.subTest(response=response):
                self.state.reset()
                parser = SitemapParser(SimpleNamespace(fetch=AsyncMock(return_value=response)), self.state)
                asyncio.run(parser.parse_all())
                self.assertEqual(self.state.error_count, 5)

    def test_failed_discovery_records_failure(self):
        for cls, method, arg in ((FAQCrawler, "discover_faq_urls", []),
                                 (BlogCrawler, "discover_blog_urls", []),
                                 (CategoryCrawler, "discover_products", set())):
            with self.subTest(crawler=cls.__name__):
                self.state.reset()
                crawler = cls(SimpleNamespace(fetch=AsyncMock(return_value=None)), self.state)
                asyncio.run(getattr(crawler, method)(arg))
                self.assertGreater(self.state.error_count, 0)

    def test_resumed_parts_phase_continues_to_generation(self):
        # State van voor het schrappen van de onderdelen-crawler mag niet blijven hangen.
        self.fill_products()
        self.state.set_phase("crawl_parts")
        marketplace = self.root / "marketplace.json"
        marketplace.write_text(json.dumps([{}] * 500))
        with patch.object(main, "CrawlState", return_value=self.state), \
             patch.object(main, "BaseCrawler", return_value=AsyncMock()), \
             patch.object(main, "KnowledgeBaseGenerator"), \
             patch.object(main, "OUTPUT_DIR", self.root), \
             patch.object(main, "KB_MARKETPLACE_FILE", marketplace):
            asyncio.run(main.run_crawler())
        stats = json.loads((self.root / "crawl-stats.json").read_text())
        self.assertEqual(stats["phase"], "done")
        self.assertEqual(stats["error_count"], 0)
        self.assertEqual(stats["additional_parts"], 0)

    def test_new_crash_removes_stale_stats(self):
        stats_file = self.root / "crawl-stats.json"
        stats_file.write_text('{"crawl_status": "completed"}')
        with patch.object(main, "OUTPUT_DIR", self.root), \
             patch.object(main, "CrawlState", side_effect=RuntimeError("startup failed")):
            with self.assertRaises(RuntimeError):
                asyncio.run(main.run_crawler())
        self.assertFalse(stats_file.exists())


if __name__ == "__main__":
    unittest.main()
