"""Voortgangslogging voor de crawler."""

import logging
import time

logger = logging.getLogger(__name__)


class ProgressTracker:
    """Houdt voortgang bij en logt periodiek."""

    def __init__(self, total: int, label: str = "items"):
        self.total = total
        self.label = label
        self.completed = 0
        self.failed = 0
        self.skipped = 0
        self.start_time = time.monotonic()
        self._last_log = 0

    def success(self):
        self.completed += 1
        self._maybe_log()

    def fail(self):
        self.failed += 1
        self._maybe_log()

    def skip(self):
        self.skipped += 1
        self._maybe_log()

    def _counts(self) -> str:
        skipped = f", {self.skipped} overgeslagen" if self.skipped else ""
        return f"{self.failed} mislukt{skipped}"

    def _maybe_log(self):
        done = self.completed + self.failed + self.skipped
        # Log elke 10 items of bij het laatste item
        if done % 10 == 0 or done == self.total:
            elapsed = time.monotonic() - self.start_time
            rate = done / elapsed if elapsed > 0 else 0
            remaining = (self.total - done) / rate if rate > 0 else 0
            logger.info(
                f"[{self.label}] {done}/{self.total} "
                f"({self.completed} OK, {self._counts()}) "
                f"- {rate:.1f}/s - ~{remaining:.0f}s resterend"
            )

    def summary(self) -> str:
        elapsed = time.monotonic() - self.start_time
        return (
            f"{self.label}: {self.completed}/{self.total} succesvol, "
            f"{self._counts()} in {elapsed:.0f}s"
        )
