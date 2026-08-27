# EXIT Toys Crawler - Kennisbank voor HALO Chatbot

## Wat doet dit systeem?

Dit systeem zorgt ervoor dat de **HALO AI-chatbot** altijd up-to-date productinformatie heeft van de EXIT Toys website. Het werkt volledig automatisch:

1. Elke ochtend om **06:00 uur** wordt de hele exittoys.nl website gescand
2. Alle producten, veelgestelde vragen (FAQs), blogposts en pagina's worden verzameld
3. Deze data wordt opgeslagen als "kennisbank" in de cloud
4. HALO haalt deze kennisbank automatisch op en gebruikt het om vragen te beantwoorden

**Je hoeft hier normaal gesproken niets aan te doen** - alles draait automatisch.

---

## Hoe werkt het? (simpele uitleg)

```
exittoys.nl website
        |
        v
  [GitHub Actions]        <-- Automatische taakplanner (draait elke ochtend)
        |
        v
  [Python Crawler]        <-- Leest alle pagina's van de website
        |
        v
  [Kennisbank JSON]       <-- Alle info in een gestructureerd bestand
        |
        v
  [Vercel Blob Storage]   <-- Cloudopslag waar het bestand wordt bewaard
        |
        v
  [API Endpoint]          <-- Adres waar HALO de data ophaalt
        |
        v
  [CM HALO Chatbot]       <-- Beantwoordt klantvragen met actuele info
```

### De drie systemen uitgelegd

| Systeem | Wat het doet | Vergelijking |
|---------|-------------|--------------|
| **GitHub Actions** | Plant en start de dagelijkse crawl automatisch | Een wekker die elke ochtend een taak start |
| **Vercel** | Host het dashboard en de API waar HALO data ophaalt | Een website met een digitale kluis voor de data |
| **HALO** | De AI-chatbot die klantvragen beantwoordt | De medewerker die het antwoordenboek gebruikt |

---

## Dashboard bekijken

Het dashboard toont de status van de kennisbank:

**URL:** https://exit-toys-crawler-vercel.vercel.app

Hier zie je:
- **Laatste update** - Wanneer de crawler voor het laatst heeft gedraaid
- **Totaal entries** - Hoeveel items er in de kennisbank zitten
- **Verdeling** - Hoeveel producten, FAQs, blogs en pagina's

Als je hier "Nog geen data beschikbaar" ziet, heeft de crawler nog niet gedraaid.

---

## Handmatig een crawl starten

Soms wil je de kennisbank direct bijwerken, bijvoorbeeld na een grote productwijziging op de website. Dit kan op twee manieren:

### Optie 1: Via het dashboard (aanbevolen)

De makkelijkste manier — geen GitHub-account nodig.

1. **Ga naar het dashboard:**
   - Open https://exit-toys-crawler-vercel.vercel.app

2. **Klik op "Handmatig crawlen":**
   - Je vindt deze knop bovenaan het dashboard onder "Crawl starten"

3. **Bevestig:**
   - Er verschijnt een bevestigingsvraag: "Weet je het zeker?"
   - Klik op **"Ja, start de crawl"** om te bevestigen, of op **"Annuleren"** om af te breken

4. **Wacht tot het klaar is:**
   - De crawl duurt 20–45 minuten
   - Als er al een crawl draait, krijg je hier een melding van

5. **Controleer het resultaat:**
   - Ververs het dashboard na 20–45 minuten
   - Controleer of de "Laatste update" is bijgewerkt

### Optie 2: Via GitHub Actions

Alternatief voor wie toegang heeft tot GitHub.

1. **Ga naar GitHub Actions:**
   - Open https://github.com/svendijk2408/exit-toys-crawler-vercel/actions
   - Log in met het EXIT GitHub-account

2. **Selecteer de workflow:**
   - Klik links op **"EXIT Toys Crawler"**

3. **Start de crawl:**
   - Klik op de **"Run workflow"** knop (rechtsboven, grijs)
   - Klik op de groene **"Run workflow"** knop in het dropdown-menu

4. **Wacht tot het klaar is:**
   - Je ziet een nieuwe run verschijnen met een geel bolletje (= bezig)
   - Na 20-45 minuten wordt dit een groen vinkje (= gelukt) of een rood kruisje (= mislukt)

5. **Controleer het resultaat:**
   - Ga naar het dashboard: https://exit-toys-crawler-vercel.vercel.app
   - Controleer of de "Laatste update" is bijgewerkt

### Stap 2: Robin synchroniseren (verplicht na handmatige crawl)

Na elke handmatige crawl moet je ook **handmatig een sync triggeren in Robin**, zodat de chatbot de nieuwe data daadwerkelijk ophaalt.

1. **Ga naar Robin:**
   - Open het Robin-dashboard en navigeer naar **Knowledge**

2. **Klik op "Sync":**
   - Rechtsboven op de Knowledge-pagina staat een **"Sync"**-knop
   - Klik hierop om Robin de nieuwe kennisbank te laten ophalen

3. **Wacht op bevestiging:**
   - Bovenaan verschijnt een melding: *"Synchronisation requested on … by CM.com - Automatic Synchronisation successful"*
   - De status van de API Connections verandert naar **Synced**

> **Waarom is dit nodig?** Bij de dagelijkse automatische crawl (06:00) synchroniseert Robin automatisch. Maar bij een handmatige crawl moet je de sync zelf triggeren, anders gebruikt de chatbot nog de oude data.

### Let op

- **Start geen nieuwe crawl als er al een draait** — het dashboard toont een melding als er een actieve crawl is
- De crawl duurt 20–45 minuten, dit is normaal
- **Vergeet niet de Robin sync!** Na een handmatige crawl moet je altijd ook in Robin op "Sync" klikken
- Als een crawl mislukt, probeer het nog een keer. Lukt het daarna nog niet? Neem contact op met Sven

---

## Wat wordt er precies gecrawld?

| Type | Wat | Voorbeelden |
|------|-----|-------------|
| **Producten** | Alle productpagina's | Trampolines, zwembaden, speelhuisjes, sport |
| **FAQs** | Veelgestelde vragen | Levering, retourneren, veiligheid, onderhoud |
| **Blogs** | Alle blogartikelen | Tips, gidsen, productnieuws |
| **Pagina's** | Informatiepagina's | Over ons, contact, leveringsinfo |

De crawler slaat de volgende pagina's bewust over: homepage, zoekpagina, winkelwagen, account en checkout.

---

## Hoe komt de data in HALO?

HALO is gekoppeld via een **API Connection**. Dit werkt als volgt:

1. HALO is ingesteld om data op te halen van dit adres:
   ```
   GET https://exit-toys-crawler-vercel.vercel.app/api/knowledge-base
   ```
2. Dit endpoint geeft een lijst terug met items, elk met:
   - **trigger** - Zoekwoorden (productnaam, artikelnummer, categorie)
   - **content** - De volledige productinfo, specificaties, FAQ-antwoorden, etc.
3. Wanneer een klant een vraag stelt, zoekt HALO in de triggers naar relevante items
4. De bijbehorende content wordt gebruikt om een antwoord te formuleren

**De HALO-koppeling hoeft niet aangepast te worden** - zolang de crawler draait, blijft de data actueel.

---

## Marketplace productfeed

Naast de HALO-kennisbank levert dit systeem ook een **marketplace productfeed** met gestructureerde productinformatie. Bedoeld voor partners/collega's die alle productinfo per SKU/EAN nodig hebben.

**Endpoints:**
```
GET https://exit-toys-crawler-vercel.vercel.app/api/marketplace/producten      (NL)
GET https://exit-toys-crawler-vercel.vercel.app/api/de/marketplace/producten   (DE)
```

**Format** — JSON array met per product:
- `sku` - Artikelnummer
- `ean` - EAN-code (gtin13)
- `title` - Producttitel
- `content` - Volledige productinhoud (prijs, voorraadstatus, levertijd, categorie, beschrijving, specs, USPs, FAQs)

Producten zonder SKU worden overgeslagen. De feed gebruikt dezelfde dagelijkse crawl als de HALO-kennisbank — geen extra requests naar exittoys.nl/.de.

---

## Veelgestelde vragen

### De crawler is mislukt, wat nu?
1. Ga naar GitHub Actions en klik op de mislukte run (rood kruisje)
2. Klik op **"crawl-and-upload"** om de logberichten te zien
3. Meestal is het een tijdelijk probleem (website traag, time-out). Probeer het opnieuw via "Run workflow"
4. Lukt het na 2 pogingen niet? Neem contact op met Sven

### De chatbot geeft verouderde informatie
Controleer op het dashboard wanneer de laatste update was. Als dit meer dan 2 dagen geleden is, start handmatig een crawl. Als de crawl wel recent is maar de info niet klopt, kan het zijn dat:
- De website nog niet is bijgewerkt
- HALO de cache nog niet heeft ververst (duurt maximaal 1 uur)

### Er is een nieuw product toegevoegd aan de website
De crawler pikt dit automatisch op bij de volgende run (06:00 uur). Wil je het sneller? Start handmatig een crawl.

### Kan ik zien wat er in de kennisbank zit?
Ja, open deze URL in je browser:
```
https://exit-toys-crawler-vercel.vercel.app/api/knowledge-base
```
Je krijgt dan de volledige kennisbank te zien als tekst (dit is het ruwe bestand dat HALO gebruikt).

### Hoeveel kost dit systeem?
- **GitHub Actions**: Gratis (binnen de gratis limiet van GitHub)
- **Vercel**: Gratis (Hobby plan, voldoende voor dit gebruik)
- **Totaal**: Geen kosten

---

## Overzicht van de automatische planning

| Wat | Wanneer | Hoe |
|-----|---------|-----|
| Crawler draait | Elke dag om 06:00 NL | Automatisch via GitHub Actions |
| Kennisbank wordt bijgewerkt | Direct na succesvolle crawl | Automatisch upload naar Vercel |
| HALO haalt nieuwe data op | Bij elk klantgesprek (met 1 uur cache) | Automatisch via API |

---

## Technische details (voor ontwikkelaars)

<details>
<summary>Klik om technische details te bekijken</summary>

### Stack
- **Crawler**: Python 3.12 (aiohttp, BeautifulSoup4, Playwright)
- **Frontend/API**: Next.js 16, React 19, TypeScript
- **Hosting**: Vercel (Edge runtime)
- **Opslag**: Vercel Blob Storage
- **CI/CD**: GitHub Actions

### Repository
https://github.com/svendijk2408/exit-toys-crawler-vercel

### Projectstructuur
```
exit-toys-crawler-vercel/
├── .github/workflows/crawl.yml    # Automatische planning
├── crawler/                        # Python webcrawler
│   ├── crawlers/                   # URL-discovery en ophalen
│   ├── parsers/                    # HTML-extractie
│   ├── formatters/                 # Data-formattering
│   ├── utils/                      # Hulpfuncties
│   ├── config.py                   # Configuratie
│   └── main.py                     # Startpunt
├── src/app/                        # Next.js frontend
│   ├── api/knowledge-base/route.ts # Kennisbank API-endpoint
│   ├── api/trigger-crawl/route.ts  # Handmatig crawl triggeren (GitHub Actions)
│   ├── components/                 # Client-side componenten
│   └── page.tsx                    # Dashboard
├── scripts/upload-to-blob.mjs      # Upload script
├── vercel.json                     # Vercel configuratie
└── package.json                    # Node.js dependencies
```

### Environment variabelen
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob Storage token (opgeslagen in GitHub Secrets en Vercel)
- `GITHUB_PAT` - GitHub Personal Access Token met `actions:write` en `contents:read` scope (opgeslagen in Vercel environment variables). Nodig voor de "Handmatig crawlen" knop op het dashboard.

### Rate limiting
- Max 3 gelijktijdige requests naar exittoys.nl
- Max 2 requests per seconde
- 30 seconden timeout per request
- Automatische retry (max 3 pogingen)

### API Response format
```json
[
  {
    "trigger": "EXIT Elegant Premium Trampoline 244 52.74.10.00",
    "content": "Product: EXIT Elegant Premium Trampoline\nPrijs: ..."
  }
]
```

</details>
