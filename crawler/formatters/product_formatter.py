"""Product formatter - zet productdata om naar trigger/content format."""


class ProductFormatter:
    """Formatteert productdata naar kennisbank entries."""

    def __init__(self, labels: dict[str, str]):
        self.labels = labels

    def format(self, product: dict) -> dict:
        """Converteer een product dict naar trigger/content entry."""
        name = product.get("name", "")
        sku = product.get("sku", "")
        category = product.get("category", "")
        model = product.get("model", "")
        size = product.get("size", "")

        # Trigger: productnaam, categorie, serie, artikelnr + zoekwoorden
        trigger_parts = [name]
        if category:
            trigger_parts.append(category)
        if model and model not in name:
            trigger_parts.append(model)
        if size and size not in name:
            trigger_parts.append(size)
        if sku:
            trigger_parts.append(sku)

        # Gewicht toevoegen als het er is
        weight = self._get_spec_value(product, self.labels["weight"])
        if weight:
            trigger_parts.append(f"{self.labels['weight']} {weight}")

        trigger = " ".join(trigger_parts)

        # Prijs formatteren met decimalen
        price = product.get("price", "")
        if price:
            try:
                price_formatted = f"{float(price):.2f}"
            except (ValueError, TypeError):
                price_formatted = price
        else:
            price_formatted = ""

        # Content opbouwen
        content_parts = []
        content_parts.append(f"Product: {name}")

        if price_formatted:
            content_parts.append(f"{self.labels['price']}: \u20ac{price_formatted}")
        if sku:
            content_parts.append(f"{self.labels['sku']}: {sku}")

        # Voorraad + levertijd
        availability = product.get("availability", "")
        if availability:
            content_parts.append(self._labeled(self.labels["stock"], availability))
        delivery = product.get("delivery", "")
        if delivery:
            content_parts.append(self._labeled(self.labels["delivery"], delivery))

        if category:
            content_parts.append(f"{self.labels['category']}: {category}")
        if model:
            content_parts.append(f"{self.labels['series']}: {model}")

        # Type uit specificaties
        product_type = self._get_spec_value(product, self.labels["type"])
        if product_type:
            content_parts.append(f"{self.labels['type']}: {product_type}")
        elif product.get("type") == "onderdeel":
            content_parts.append(f"{self.labels['type']}: {self.labels['type_part']}")

        if size:
            content_parts.append(f"{self.labels['dimensions']}: {size}")

        # Kleur
        color = product.get("color", "") or self._get_spec_value(product, self.labels["color_spec_key"])
        if color:
            content_parts.append(f"{self.labels['color']}: {color}")

        content_parts.append(f"URL: {product.get('url', '')}")

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

        # Aanbevolen accessoires
        content_parts.extend(self._accessory_lines(product))

        # Specificaties
        specs = product.get("specifications", [])
        if specs:
            content_parts.append(f"\n{self.labels['specifications']}:")
            for group in specs:
                content_parts.append(f"[{group['group']}]")
                for spec in group["specs"]:
                    content_parts.append(f"{spec['key']}: {spec['value']}")

        # On-page FAQs
        faqs = product.get("faqs", [])
        if faqs:
            content_parts.append(f"\n{self.labels['faq']}:")
            for faq in faqs:
                content_parts.append(f"{self.labels['q']}: {faq['question']}")
                content_parts.append(f"{self.labels['a']}: {faq['answer']}")

        content = "\n".join(content_parts)

        entry = {"trigger": trigger, "content": content}

        # Categorie meegeven zodat knowledge_base.py hierop kan groeperen
        if product.get("type") == "onderdeel":
            entry["category"] = "onderdelen"
        elif category:
            entry["category"] = category.lower()

        return entry

    def _accessory_lines(self, product: dict) -> list[str]:
        """Aanbevolen accessoires als regels: naam, artikelnummer, prijs, voorraad en link."""
        accessories = product.get("accessories") or []
        if not accessories:
            return []
        lines = [f"\n{self.labels['accessories']}:"]
        for acc in accessories:
            parts = [acc.get("name", ""), f"{self.labels['sku']} {acc.get('sku', '')}"]
            price = acc.get("price", "")
            if price:
                try:
                    parts.append(f"\u20ac{float(price):.2f}")
                except (ValueError, TypeError):
                    parts.append(f"\u20ac{price}")
            if acc.get("availability"):
                parts.append(acc["availability"])
            if acc.get("url"):
                parts.append(acc["url"])
            lines.append("- " + " | ".join(p for p in parts if p))
        return lines

    @staticmethod
    def _labeled(label: str, text: str) -> str:
        """Prefix met label, tenzij de tekst het label zelf al bevat."""
        if text.lower().startswith(label.lower()):
            return text
        return f"{label}: {text}"

    def _get_spec_value(self, product: dict, key: str) -> str:
        """Zoek een specifieke spec waarde."""
        for group in product.get("specifications", []):
            for spec in group["specs"]:
                if spec["key"].lower() == key.lower():
                    return spec["value"]
        return ""
