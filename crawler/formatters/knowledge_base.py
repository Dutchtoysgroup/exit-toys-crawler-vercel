"""Knowledge base generator - combineert alle data tot finaal JSON."""

from __future__ import annotations

import json
import logging
import shutil

from config import (
    KB_FAQS_FILE,
    KB_MARKETPLACE_FILE,
    KB_PAGINAS_FILE,
    KB_PRODUCTEN_FILE,
    KB_PRODUCTEN_CATEGORY_FILES,
    KNOWLEDGE_BASE_COPY,
    KNOWLEDGE_BASE_FILE,
    LOCALE_CONFIG,
    PRODUCT_CATEGORIES,
)
from formatters.blog_formatter import BlogFormatter
from formatters.faq_formatter import FAQFormatter
from formatters.marketplace_formatter import MarketplaceFormatter
from formatters.page_formatter import PageFormatter
from formatters.product_formatter import ProductFormatter

logger = logging.getLogger(__name__)


class KnowledgeBaseGenerator:
    """Genereert de finale kennisbank JSON uit alle gecrawlde data."""

    def __init__(self):
        labels = LOCALE_CONFIG.labels
        self.product_fmt = ProductFormatter(labels)
        self.marketplace_fmt = MarketplaceFormatter(labels)
        self.faq_fmt = FAQFormatter(labels)
        self.blog_fmt = BlogFormatter(labels, LOCALE_CONFIG.blog_categories)
        self.page_fmt = PageFormatter(LOCALE_CONFIG.page_keyword_map)

    def generate(self, results: dict) -> dict[str, list[dict]]:
        """Genereer kennisbank entries uit alle resultaten, gecategoriseerd.

        Args:
            results: Dict met keys products, faqs, blogs, pages, parts

        Returns:
            Dict met keys 'producten', 'faqs', 'paginas', 'marketplace' — elk een lijst van entries
        """
        producten = []
        marketplace = []
        faqs = []
        paginas = []

        # Producten
        products = results.get("products", [])
        for product in products:
            try:
                entry = self.product_fmt.format(product)
                producten.append(entry)
            except Exception as e:
                logger.error(f"Product format fout: {e}")
            try:
                mp_entry = self.marketplace_fmt.format(product)
                if mp_entry:
                    marketplace.append(mp_entry)
            except Exception as e:
                logger.error(f"Marketplace format fout: {e}")

        # Onderdelen (zelfde format als producten)
        parts = results.get("parts", [])
        for part in parts:
            try:
                entry = self.product_fmt.format(part)
                producten.append(entry)
            except Exception as e:
                logger.error(f"Onderdeel format fout: {e}")
            try:
                mp_entry = self.marketplace_fmt.format(part)
                if mp_entry:
                    marketplace.append(mp_entry)
            except Exception as e:
                logger.error(f"Marketplace onderdeel format fout: {e}")

        # FAQs
        faq_items = results.get("faqs", [])
        seen_questions = set()
        for faq in faq_items:
            try:
                q = faq.get("question", "")
                if q not in seen_questions:
                    entry = self.faq_fmt.format(faq)
                    faqs.append(entry)
                    seen_questions.add(q)
            except Exception as e:
                logger.error(f"FAQ format fout: {e}")

        # Blogs
        blogs = results.get("blogs", [])
        for blog in blogs:
            try:
                entry = self.blog_fmt.format(blog)
                paginas.append(entry)
            except Exception as e:
                logger.error(f"Blog format fout: {e}")

        # Pagina's
        pages = results.get("pages", [])
        for page in pages:
            try:
                entry = self.page_fmt.format(page)
                paginas.append(entry)
            except Exception as e:
                logger.error(f"Pagina format fout: {e}")

        # Dedupliceer per categorie
        producten = self._deduplicate(producten)
        faqs = self._deduplicate(faqs)
        paginas = self._deduplicate(paginas)
        marketplace = self._deduplicate_marketplace(marketplace)

        logger.info(
            f"Kennisbank: {len(producten)} producten, "
            f"{len(faqs)} FAQs, {len(paginas)} pagina's, "
            f"{len(marketplace)} marketplace — "
            f"{len(producten) + len(faqs) + len(paginas)} totaal"
        )

        return {"producten": producten, "faqs": faqs, "paginas": paginas, "marketplace": marketplace}

    def _categorize_product(self, entry: dict) -> str:
        """Bepaal de categorie-slug voor een product entry."""
        # Gebruik het category veld dat de formatter heeft meegegeven
        cat = entry.get("category", "")
        text = f"{entry.get('trigger', '')} {entry.get('content', '')}".lower()

        for slug, keywords in PRODUCT_CATEGORIES.items():
            if slug == "overig":
                continue
            # Directe match op formatter-category
            if cat and any(kw in cat for kw in keywords):
                return slug
            # Fallback: zoekwoorden in trigger+content
            if any(kw in text for kw in keywords):
                return slug

        return "overig"

    def save(self, categorized: dict[str, list[dict]]):
        """Sla de kennisbank op als JSON-bestanden (splits + per categorie + gecombineerd + marketplace)."""
        producten = categorized["producten"]
        faqs = categorized["faqs"]
        paginas = categorized["paginas"]
        marketplace = categorized.get("marketplace", [])

        # Strip category veld voor output (HALO verwacht alleen trigger/content)
        def strip_category(entries: list[dict]) -> list[dict]:
            return [{k: v for k, v in e.items() if k != "category"} for e in entries]

        producten_clean = strip_category(producten)
        combined = producten_clean + faqs + paginas

        # Schrijf split bestanden
        for path, entries, label in [
            (KB_PRODUCTEN_FILE, producten_clean, "producten"),
            (KB_FAQS_FILE, faqs, "faqs"),
            (KB_PAGINAS_FILE, paginas, "paginas"),
        ]:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(entries, f, ensure_ascii=False, indent=2)
            logger.info(f"Opgeslagen: {path} ({len(entries)} {label})")

        # Per-categorie bestanden
        categorized_products: dict[str, list[dict]] = {slug: [] for slug in PRODUCT_CATEGORIES}
        for entry in producten:
            slug = self._categorize_product(entry)
            categorized_products[slug].append(entry)

        for slug, entries in categorized_products.items():
            path = KB_PRODUCTEN_CATEGORY_FILES[slug]
            clean_entries = strip_category(entries)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(clean_entries, f, ensure_ascii=False, indent=2)
            logger.info(f"Opgeslagen: {path} ({len(clean_entries)} {slug})")

        # Marketplace bestand
        with open(KB_MARKETPLACE_FILE, "w", encoding="utf-8") as f:
            json.dump(marketplace, f, ensure_ascii=False, indent=2)
        logger.info(f"Opgeslagen: {KB_MARKETPLACE_FILE} ({len(marketplace)} marketplace entries)")

        # Gecombineerd bestand (backward compatibility)
        with open(KNOWLEDGE_BASE_FILE, "w", encoding="utf-8") as f:
            json.dump(combined, f, ensure_ascii=False, indent=2)
        logger.info(f"Opgeslagen: {KNOWLEDGE_BASE_FILE} ({len(combined)} entries)")

        # Kopie naar Downloads (overslaan in CI-modus)
        if KNOWLEDGE_BASE_COPY is not None:
            try:
                shutil.copy2(KNOWLEDGE_BASE_FILE, KNOWLEDGE_BASE_COPY)
                logger.info(f"Kopie: {KNOWLEDGE_BASE_COPY}")
            except Exception as e:
                logger.warning(f"Kon geen kopie maken naar Downloads: {e}")

    def _deduplicate(self, entries: list[dict]) -> list[dict]:
        """Verwijder duplicate entries op basis van trigger."""
        seen = set()
        unique = []
        for entry in entries:
            trigger = entry.get("trigger", "")
            if trigger not in seen:
                seen.add(trigger)
                unique.append(entry)
        return unique

    def _deduplicate_marketplace(self, entries: list[dict]) -> list[dict]:
        """Verwijder duplicate marketplace entries op basis van SKU."""
        seen = set()
        unique = []
        for entry in entries:
            sku = entry.get("sku", "")
            if sku not in seen:
                seen.add(sku)
                unique.append(entry)
        return unique
