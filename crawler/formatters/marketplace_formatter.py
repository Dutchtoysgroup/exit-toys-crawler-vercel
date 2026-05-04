"""Marketplace formatter - zet productdata om naar SKU/EAN/titel/inhoud format."""


class MarketplaceFormatter:
    """Formatteert productdata naar marketplace entries."""

    def __init__(self, labels: dict[str, str]):
        self.labels = labels

    def format(self, product: dict) -> dict | None:
        """Converteer een product dict naar marketplace entry.

        Returns None als SKU ontbreekt (niet bruikbaar voor marketplace).
        """
        sku = product.get("sku", "").strip()
        if not sku:
            return None

        ean = product.get("gtin13", "").strip()
        title = product.get("name", "").strip()

        content_parts = []

        # Prijs
        price = product.get("price", "")
        if price:
            try:
                price_formatted = f"{float(price):.2f}"
            except (ValueError, TypeError):
                price_formatted = price
            content_parts.append(f"{self.labels['price']}: €{price_formatted}")

        # Beschikbaarheid
        availability = product.get("availability", "")
        if availability:
            content_parts.append(f"Status: {availability}")

        # Categorie
        category = product.get("category", "")
        if category:
            content_parts.append(f"{self.labels['category']}: {category}")

        # Serie
        model = product.get("model", "")
        if model:
            content_parts.append(f"{self.labels['series']}: {model}")

        # Afmetingen
        size = product.get("size", "")
        if size:
            content_parts.append(f"{self.labels['dimensions']}: {size}")

        # Kleur
        color = product.get("color", "") or self._get_spec_value(product, self.labels["color_spec_key"])
        if color:
            content_parts.append(f"{self.labels['color']}: {color}")

        # URL
        url = product.get("url", "")
        if url:
            content_parts.append(f"URL: {url}")

        # Beschrijving
        desc = product.get("description", "")
        if desc:
            content_parts.append(f"\n{self.labels['description']}:\n{desc}")

        # USPs
        usps = product.get("usps", [])
        if usps:
            content_parts.append(f"\n{self.labels['features']}:")
            for usp in usps:
                content_parts.append(f"- {usp}")

        # Specificaties
        specs = product.get("specifications", [])
        if specs:
            content_parts.append(f"\n{self.labels['specifications']}:")
            for group in specs:
                content_parts.append(f"[{group['group']}]")
                for spec in group["specs"]:
                    content_parts.append(f"{spec['key']}: {spec['value']}")

        # Levertijd
        delivery = product.get("delivery", "")
        if delivery:
            content_parts.append(f"\n{delivery}")

        # On-page FAQs
        faqs = product.get("faqs", [])
        if faqs:
            content_parts.append(f"\n{self.labels['faq']}:")
            for faq in faqs:
                content_parts.append(f"{self.labels['q']}: {faq['question']}")
                content_parts.append(f"{self.labels['a']}: {faq['answer']}")

        content = "\n".join(content_parts)

        return {
            "sku": sku,
            "ean": ean,
            "title": title,
            "content": content,
        }

    def _get_spec_value(self, product: dict, key: str) -> str:
        for group in product.get("specifications", []):
            for spec in group["specs"]:
                if spec["key"].lower() == key.lower():
                    return spec["value"]
        return ""
