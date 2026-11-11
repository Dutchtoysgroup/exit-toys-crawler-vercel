"""Rate limiter voor async HTTP requests."""

import asyncio
import time


class RateLimiter:
    """Geeft verzoeken gelijkmatig vrij: nooit meer dan `rate` per seconde, zonder pieken."""

    def __init__(self, rate: float):
        self.interval = 1 / rate
        self._next_slot = 0.0

    async def acquire(self):
        """Wacht tot het volgende vrije moment."""
        now = time.monotonic()
        slot = max(now, self._next_slot)
        # Reserveer het moment vóór het wachten, zodat gelijktijdige aanroepen elk een eigen
        # moment krijgen.
        self._next_slot = slot + self.interval
        if slot > now:
            await asyncio.sleep(slot - now)
