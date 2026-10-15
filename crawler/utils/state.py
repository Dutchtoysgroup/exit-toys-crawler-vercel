"""Resume state management - checkpoint na elke batch."""

import json
import logging
from pathlib import Path

from config import STATE_FILE

logger = logging.getLogger(__name__)


class CrawlState:
    """Beheert crawl state voor resume functionaliteit."""

    def __init__(self):
        self.state = {
            "failures": [],
            "skipped": [],
            "completed_urls": [],
            "discovered_urls": {},
            "phase": "init",
            "results": {
                "products": [],
                "faqs": [],
                "blogs": [],
                "pages": [],
                "parts": [],
            },
        }
        self._load()

    def _load(self):
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE) as f:
                    saved = json.load(f)
                self.state.update(saved)
                logger.info(
                    f"State geladen: {len(self.state['completed_urls'])} URLs voltooid, "
                    f"fase: {self.state['phase']}"
                )
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"State bestand corrupt, start opnieuw: {e}")

    def save(self):
        STATE_FILE.parent.mkdir(exist_ok=True)
        with open(STATE_FILE, "w") as f:
            json.dump(self.state, f, ensure_ascii=False)

    def is_completed(self, url: str) -> bool:
        return url in self.state["completed_urls"]

    def mark_completed(self, url: str):
        if url not in self.state["completed_urls"]:
            self.state["completed_urls"].append(url)

    def record_failure(self, source: str):
        """Afgehandeld betekent niet geslaagd; bewaar fouten ook bij hervatten."""
        if source not in self.state["failures"]:
            self.state["failures"].append(source)
            logger.warning(f"Crawlfout: {source}")

    def record_skip(self, url: str, reason: str):
        """Bereikbare pagina zonder bruikbare inhoud (andere layout): geen crawlfout."""
        if url not in self.state["skipped"]:
            self.state["skipped"].append(url)
            logger.warning(f"Overgeslagen ({reason}): {url}")

    @property
    def error_count(self) -> int:
        return len(self.state["failures"])

    @property
    def failures(self) -> list[str]:
        return list(self.state["failures"])

    @property
    def skipped(self) -> list[str]:
        return list(self.state["skipped"])

    def add_result(self, category: str, entry: dict):
        if category in self.state["results"]:
            self.state["results"][category].append(entry)

    def add_results(self, category: str, entries: list):
        if category in self.state["results"]:
            self.state["results"][category].extend(entries)

    def get_results(self, category: str) -> list:
        return self.state["results"].get(category, [])

    def all_results(self) -> dict:
        return self.state["results"]

    def set_phase(self, phase: str):
        self.state["phase"] = phase
        self.save()

    @property
    def phase(self) -> str:
        return self.state["phase"]

    def set_discovered_urls(self, category: str, urls: list):
        self.state["discovered_urls"][category] = urls

    def get_discovered_urls(self, category: str) -> list:
        return self.state["discovered_urls"].get(category, [])

    def pending_urls(self, category: str) -> list:
        discovered = set(self.get_discovered_urls(category))
        completed = set(self.state["completed_urls"])
        return list(discovered - completed)

    def reset(self):
        self.state = {
            "failures": [],
            "skipped": [],
            "completed_urls": [],
            "discovered_urls": {},
            "phase": "init",
            "results": {
                "products": [],
                "faqs": [],
                "blogs": [],
                "pages": [],
                "parts": [],
            },
        }
        self.save()
