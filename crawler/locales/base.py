"""Base dataclass voor locale-specifieke configuratie."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class LocaleConfig:
    """Alle locale-specifieke waarden voor de crawler."""

    locale: str
    base_url: str

    # URL paden
    faq_index_path: str
    blog_index_path: str
    category_pages: list[str]
    skip_paths: set[str]

    # Product categorisatie
    product_categories: dict[str, list[str]]
    category_slugs: list[str] = field(default_factory=list)

    # Formatter labels
    labels: dict[str, str] = field(default_factory=dict)

    # Blog categorie keywords
    blog_categories: dict[str, str] = field(default_factory=dict)

    # Page keyword map
    page_keyword_map: dict[str, str] = field(default_factory=dict)

    # Parser labels
    in_stock_text: str = ""
    out_of_stock_text: str = ""
    written_by_prefix: str = ""

    # Crawler filters
    job_posting_keyword: str = ""

    # User agent
    user_agent: str = ""

    def __post_init__(self):
        if not self.category_slugs:
            self.category_slugs = list(self.product_categories.keys())
