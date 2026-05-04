"""Configuratie voor EXIT Toys website crawler."""

import os
from pathlib import Path

from locales import get_locale_config

# CI-detectie: GitHub Actions zet CI=true
IS_CI = os.environ.get("CI", "").lower() == "true"

# Locale (nl of de)
LOCALE = os.environ.get("CRAWLER_LOCALE", "nl")
LOCALE_CONFIG = get_locale_config(LOCALE)

# Project paden
PROJECT_DIR = Path(__file__).parent

if IS_CI:
    OUTPUT_DIR = Path(f"/tmp/crawler-output-{LOCALE}")
    STATE_DIR = Path(f"/tmp/crawler-state-{LOCALE}")
    LOGS_DIR = Path(f"/tmp/crawler-logs-{LOCALE}")
else:
    suffix = "" if LOCALE == "nl" else f"-{LOCALE}"
    OUTPUT_DIR = PROJECT_DIR / f"output{suffix}"
    STATE_DIR = PROJECT_DIR / f"state{suffix}"
    LOGS_DIR = PROJECT_DIR / f"logs{suffix}"

# Output bestanden
KNOWLEDGE_BASE_FILE = OUTPUT_DIR / "exittoys_knowledge_base.json"
KB_PRODUCTEN_FILE = OUTPUT_DIR / "producten.json"
KB_FAQS_FILE = OUTPUT_DIR / "faqs.json"
KB_PAGINAS_FILE = OUTPUT_DIR / "paginas.json"
KNOWLEDGE_BASE_COPY = None if IS_CI else Path.home() / "Downloads" / f"exittoys_knowledge_base{'_' + LOCALE if LOCALE != 'nl' else ''}.json"

# Product categorieën uit locale config
PRODUCT_CATEGORIES = LOCALE_CONFIG.product_categories

# Per-categorie output bestanden
KB_PRODUCTEN_CATEGORY_FILES = {
    slug: OUTPUT_DIR / f"producten-{slug}.json"
    for slug in PRODUCT_CATEGORIES
}
KB_MARKETPLACE_FILE = OUTPUT_DIR / "marketplace-producten.json"

# Website
BASE_URL = LOCALE_CONFIG.base_url
SITEMAPS = [
    f"{BASE_URL}/sitemap-products.xml",
    f"{BASE_URL}/sitemap-pages.xml",
    f"{BASE_URL}/sitemap-faqs.xml",
    f"{BASE_URL}/sitemap-blog.xml",
]

# Rate limiting
MAX_CONCURRENT = 3
REQUESTS_PER_SECOND = 2.0
REQUEST_TIMEOUT = 30
RETRY_COUNT = 3
RETRY_BACKOFF = 2  # exponential backoff factor

# Batch grootte voor checkpointing
BATCH_SIZE = 50

# User agent
USER_AGENT = LOCALE_CONFIG.user_agent

# URL patronen uit locale config
FAQ_INDEX_URL = f"{BASE_URL}{LOCALE_CONFIG.faq_index_path}"
FAQ_INDEX_PATH = LOCALE_CONFIG.faq_index_path
BLOG_INDEX_URL = f"{BASE_URL}{LOCALE_CONFIG.blog_index_path}"
PARTS_BASE_URL = f"{BASE_URL}{LOCALE_CONFIG.parts_path}"

# Categoriepagina's voor product-discovery
CATEGORY_PAGES = LOCALE_CONFIG.category_pages

# Pagina's om te skippen
SKIP_PATHS = LOCALE_CONFIG.skip_paths

# Crawler filters
JOB_POSTING_KEYWORD = LOCALE_CONFIG.job_posting_keyword

# Logging
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

# Maak directories aan
for d in [OUTPUT_DIR, STATE_DIR, LOGS_DIR]:
    d.mkdir(exist_ok=True, parents=True)

# State bestanden
STATE_FILE = STATE_DIR / "state.json"
