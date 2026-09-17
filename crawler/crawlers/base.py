"""Base async HTTP crawler met rate limiting, retries en semaphore."""

from __future__ import annotations

import asyncio
import logging

import aiohttp

from config import MAX_CONCURRENT, REQUEST_TIMEOUT, USER_AGENT
from utils.rate_limiter import RateLimiter
from utils.retry import retry

logger = logging.getLogger(__name__)


class BaseCrawler:
    """Async HTTP crawler met ingebouwde rate limiting en retries."""

    def __init__(self):
        self.semaphore = asyncio.Semaphore(MAX_CONCURRENT)
        self.rate_limiter = RateLimiter()
        self.session: aiohttp.ClientSession | None = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={"User-Agent": USER_AGENT},
            timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
        )
        return self

    async def __aexit__(self, *args):
        if self.session:
            await self.session.close()

    @retry(max_retries=3, backoff_factor=2.0, exceptions=(aiohttp.ClientError, asyncio.TimeoutError))
    async def fetch(self, url: str, timeout: float | None = None) -> str | None:
        """Haal een URL op met rate limiting en semaphore.

        `timeout` overschrijft REQUEST_TIMEOUT voor trage bestanden zoals grote sitemaps.
        """
        kwargs = {"timeout": aiohttp.ClientTimeout(total=timeout)} if timeout else {}
        async with self.semaphore:
            await self.rate_limiter.acquire()
            async with self.session.get(url, **kwargs) as response:
                if response.status == 404:
                    logger.debug(f"404: {url}")
                    return None
                if response.status == 429:
                    retry_after = int(response.headers.get("Retry-After", 10))
                    logger.warning(f"429 rate limited, wacht {retry_after}s: {url}")
                    await asyncio.sleep(retry_after)
                    raise aiohttp.ClientError(f"429 Too Many Requests: {url}")
                response.raise_for_status()
                return await response.text()

    async def fetch_many(self, urls: list[str]) -> dict[str, str | None]:
        """Haal meerdere URLs op, retourneert dict van url -> html."""
        tasks = {url: asyncio.create_task(self._safe_fetch(url)) for url in urls}
        results = {}
        for url, task in tasks.items():
            results[url] = await task
        return results

    async def _safe_fetch(self, url: str) -> str | None:
        """Fetch met error handling - retourneert None bij fout."""
        try:
            return await self.fetch(url)
        except Exception as e:
            logger.error(f"Fout bij ophalen {url}: {e}")
            return None
