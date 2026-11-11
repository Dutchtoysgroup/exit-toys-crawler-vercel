# Changelog

## 2026-11-11 — v0.1.2

### Sneller
- De crawl haalt nu 3 pagina's per seconde op in plaats van 1,8. De webshop handelde verzoeken met hetzelfde sessiecookie na elkaar af; elk van de drie gelijktijdige verzoeken heeft nu een eigen sessie.
- Het downloaden loopt door terwijl de vorige batch pagina's wordt verwerkt. Dat lag eerder ruim twee minuten per land stil.
- De snelheidslimiet volgt nu de instelling `REQUESTS_PER_SECOND` in `crawler/config.py`; die werd genegeerd.
- Feedbestanden worden tegelijk geüpload en gecontroleerd in plaats van één voor één.

De verwachte duur van een volledige run (NL + DE) gaat van ongeveer 54 naar ongeveer 35 minuten. De limiet staat bewust niet hoger: exittoys.nl en .de delen één server die rond 4,7 pagina's per seconde verzadigt.

## 2026-10-31 — v0.1.1

### Beveiliging
- Beveiligingsupdates voor `undici`.
- Nieuwere beschikbare beveiligingspatches meegenomen, waaronder Next.js 16.4.3.

