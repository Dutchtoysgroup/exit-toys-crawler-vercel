"""Product parser - extractie van productdata uit HTML + JSON-LD."""

from __future__ import annotations

import copy
import json
import logging
import re

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class ProductParser:
    """Parst productpagina's en extraheert alle relevante data."""

    def __init__(self, in_stock_text: str = "Op voorraad", out_of_stock_text: str = "Niet op voorraad"):
        self.in_stock_text = in_stock_text
        self.out_of_stock_text = out_of_stock_text

    def parse(self, url: str, html: str) -> dict | None:
        """Parse een productpagina en retourneer gestructureerde data."""
        soup = BeautifulSoup(html, "lxml")

        # Controleer of dit echt een productpagina is
        product_div = soup.find("div", id="div_webshopproductversions")
        if not product_div:
            return None

        data = {
            "url": url,
            "type": "product",
        }

        # JSON-LD data (primaire bron)
        jsonld = self._parse_jsonld(soup)
        if jsonld:
            data["name"] = jsonld.get("name", "")
            data["sku"] = jsonld.get("sku", "")
            data["description_short"] = jsonld.get("description", "")
            data["brand"] = jsonld.get("brand", {}).get("name", "EXIT Toys")
            data["category"] = jsonld.get("category", "")
            data["model"] = jsonld.get("model", "")
            data["color"] = jsonld.get("color", "")
            data["size"] = jsonld.get("size", "")
            data["gtin13"] = jsonld.get("gtin13", "")
            offers = jsonld.get("offers", {})
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            data["price"] = offers.get("price", "")
            data["currency"] = offers.get("priceCurrency", "EUR")
            data["availability"] = self.in_stock_text if "InStock" in offers.get("availability", "") else self.out_of_stock_text
            data["stock_status"] = self._jsonld_stock_status(offers.get("availability", ""))
        else:
            # Fallback naar HTML data-attributen
            data["name"] = product_div.get("data-name", "")
            data["sku"] = product_div.get("data-id", "")
            data["price"] = product_div.get("data-price", "")
            data["currency"] = product_div.get("data-currency", "EUR")
            data["category"] = product_div.get("data-section", "")
            data["model"] = product_div.get("data-group", "")

        # Titel uit H1
        h1 = soup.select_one("#div_productchoices h1")
        if h1:
            data["name"] = h1.get_text(strip=True)

        # Beschrijving uit productcontent
        data["description"] = self._parse_description(soup)

        # Specificaties (gegroepeerd)
        data["specifications"] = self._parse_specifications(soup)

        # USPs
        data["usps"] = self._parse_usps(soup)

        # On-page FAQs
        data["faqs"] = self._parse_product_faqs(soup)

        # Voorraadstatus (on-page blok heeft voorrang op JSON-LD)
        stock_text, stock_status = self._parse_stock(soup)
        if stock_text:
            data["availability"] = stock_text
            data["stock_status"] = stock_status

        # Levertijd
        delivery = self._parse_delivery(soup)
        if delivery:
            data["delivery"] = delivery

        # Aanbevolen accessoires (slider onder de productinfo)
        data["accessories"] = self._parse_accessories(soup, url)

        return data

    def _parse_jsonld(self, soup: BeautifulSoup) -> dict | None:
        """Extract Product JSON-LD structured data."""
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                ld = json.loads(script.string)
                # Kan een array of een enkel object zijn
                if isinstance(ld, list):
                    for item in ld:
                        if item.get("@type") == "Product":
                            return item
                elif isinstance(ld, dict) and ld.get("@type") == "Product":
                    return ld
            except (json.JSONDecodeError, TypeError):
                continue
        return None

    # Class op het voorraadblok -> genormaliseerde status
    STOCK_CLASS_STATUS = {
        "nostock": "out_of_stock",
        "expected": "expected",
        "soldout": "sold_out",
        "backorder": "backorder",
    }

    # schema.org availability -> genormaliseerde status
    JSONLD_STOCK_STATUS = {
        "InStock": "in_stock",
        "LimitedAvailability": "in_stock",
        "PreOrder": "expected",
        "PreSale": "expected",
        "BackOrder": "backorder",
        "SoldOut": "sold_out",
        "OutOfStock": "out_of_stock",
        "Discontinued": "out_of_stock",
    }

    def _jsonld_stock_status(self, availability: str) -> str:
        """Map een schema.org availability-URL naar een genormaliseerde status."""
        for key, status in self.JSONLD_STOCK_STATUS.items():
            if availability.endswith(f"/{key}") or availability == key:
                return status
        return "unknown"

    def _parse_stock(self, soup: BeautifulSoup) -> tuple[str, str]:
        """Extract voorraadstatus uit het blok onder de H1.

        Voorbeelden: "Op voorraad, direct leverbaar", "Niet op voorraad",
        "Verwacht per 02-12-2026", "Uitverkocht voor 2026".

        Returns:
            (tekst, genormaliseerde status)
        """
        stock_elem = soup.select_one("#div_productchoices .stock")
        if not stock_elem:
            return "", ""

        # Werk op een kopie: de tooltip ("Wat betekent dit?") hoort niet in de tekst
        stock_elem = copy.copy(stock_elem)
        for elem in stock_elem.select(".tooltip, .viewtooltip"):
            elem.decompose()

        text = re.sub(r"\s+", " ", stock_elem.get_text(" ", strip=True)).strip()
        if not text:
            return "", ""

        # Non-breaking hyphens in datums normaliseren
        text = text.replace("\u2011", "-").replace("\xa0", " ")

        status = "in_stock"
        for cls in stock_elem.get("class", []):
            if cls in self.STOCK_CLASS_STATUS:
                status = self.STOCK_CLASS_STATUS[cls]
                break

        return text, status

    def _parse_delivery(self, soup: BeautifulSoup) -> str:
        """Extract de levertijd uit de bezorgtab.

        Voorbeelden: "Levertijd: 2 - 3 werkdagen",
        "Lieferung innerhalb von 2 - 3 Arbeitstagen".
        """
        tab = soup.select_one("div.tab.delivery")
        if not tab:
            return ""

        content = tab.find_next_sibling("div")
        if not content or "content" not in content.get("class", []):
            return ""

        for ctitle in content.select(".ctitle"):
            text = re.sub(r"\s+", " ", ctitle.get_text(" ", strip=True)).strip()
            if text:
                return text

        return ""

    def _parse_accessories(self, soup: BeautifulSoup, page_url: str) -> list[dict]:
        """Extract de slider "Aanbevolen accessoires" / "Empfohlenes Zubehör".

        Staat in #div_relatedproducts als `.accessories .object`; de SKU zit in
        data-identifier, de link in `.title a`. Het tabblad "Onderdelen" daarnaast
        slaan we bewust over: die onderdelen komen al via sitemap-spareparts.xml binnen.
        """
        container = soup.select_one("#div_relatedproducts .accessories")
        if not container:
            return []

        base = re.match(r"^https?://[^/]+", page_url)
        base = base.group(0) if base else ""

        items = []
        seen = set()
        for obj in container.select(".object"):
            sku = (obj.get("data-identifier") or obj.get("data-id") or "").strip()
            if not sku or sku in seen:
                continue
            seen.add(sku)

            link = obj.select_one(".title a")
            href = link.get("href", "") if link else ""
            if href.startswith("/"):
                href = base + href
            name = re.sub(r"\s+", " ", link.get_text(" ", strip=True)) if link else obj.get("data-name", "")

            stock_elem = obj.select_one(".stock")
            stock = re.sub(r"\s+", " ", stock_elem.get_text(" ", strip=True)).strip() if stock_elem else ""

            items.append({
                "sku": sku,
                "name": name,
                "price": obj.get("data-price", ""),
                "availability": stock.replace("\u2011", "-").replace("\xa0", " "),
                "url": href,
            })
        return items

    def _parse_description(self, soup: BeautifulSoup) -> str:
        """Extract productbeschrijving inclusief 'lees meer' content."""
        desc_div = soup.select_one(".content.productcontent")
        if not desc_div:
            return ""

        # Verwijder knoppen en navigatie-elementen
        for elem in desc_div.select("button, .readmore, .backtooverview"):
            elem.decompose()

        # Haal alle tekst op (inclusief hidden/lees-meer content)
        hidden = desc_div.select_one(".hidden")
        if hidden:
            # Maak hidden content zichtbaar voor extractie
            hidden["class"] = []

        parts = []
        for elem in desc_div.find_all(["h4", "h3", "h2", "p", "li"]):
            text = elem.get_text(strip=True)
            if text:
                parts.append(text)

        return "\n".join(parts)

    def _parse_specifications(self, soup: BeautifulSoup) -> list[dict]:
        """Extract gegroepeerde specificaties."""
        spec_groups = []
        features_container = soup.select_one(".content.features")
        if not features_container:
            return spec_groups

        for group in features_container.select(".features"):
            title_elem = group.select_one(".head .ctitle")
            if not title_elem:
                continue

            group_data = {
                "group": title_elem.get_text(strip=True),
                "specs": [],
            }

            for feature in group.select(".items .feature"):
                key_elem = feature.select_one(".key")
                value_elem = feature.select_one(".value")
                if key_elem and value_elem:
                    key = key_elem.get_text(strip=True)
                    value = value_elem.get_text(strip=True)
                    if key and value:
                        group_data["specs"].append({"key": key, "value": value})

            if group_data["specs"]:
                spec_groups.append(group_data)

        return spec_groups

    def _parse_usps(self, soup: BeautifulSoup) -> list[str]:
        """Extract USP punten."""
        usps = []
        for li in soup.select("#div_productchoices .usps ul li"):
            text = li.get_text(strip=True)
            if text:
                usps.append(text)
        return usps

    def _parse_product_faqs(self, soup: BeautifulSoup) -> list[dict]:
        """Extract on-page FAQ's van een productpagina."""
        faqs = []
        faq_container = soup.select_one(".faqsitem")
        if not faq_container:
            return faqs

        current_category = ""
        for elem in faq_container.select(".subtitle, .question, .answer"):
            if "subtitle" in elem.get("class", []):
                current_category = elem.get_text(strip=True)
            elif "question" in elem.get("class", []):
                faqs.append({
                    "category": current_category,
                    "question": elem.get_text(strip=True),
                    "answer": "",
                })
            elif "answer" in elem.get("class", []) and faqs:
                faqs[-1]["answer"] = elem.get_text(strip=True)

        return [f for f in faqs if f["question"] and f["answer"]]
