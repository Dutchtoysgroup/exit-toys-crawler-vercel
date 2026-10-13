// Conservative safety floors, independently configurable for each supported country.
export const LIMITS = {
  nl: { products: 500, product_urls: 500, parts: 100, regular_products: 100, marketplace_entries: 500, marketplace_coverage: 0.9 },
  de: { products: 500, product_urls: 500, parts: 100, regular_products: 100, marketplace_entries: 500, marketplace_coverage: 0.9 },
};

const METRICS = [
  { key: "product_urls", label: "Product-URL's ontdekt", critical: true },
  { key: "products", label: "Productpagina's gelezen", critical: true },
  { key: "parts", label: "Onderdelen", critical: true },
  { key: "marketplace_entries", label: "Items in marketplace-feed", critical: true },
  { key: "products_with_accessories", label: "Producten met accessoires", critical: false },
  { key: "faqs", label: "FAQ's", critical: false },
  { key: "pages", label: "Pagina's", critical: false },
  { key: "blogs", label: "Blogs", critical: false },
];

export function validateStats(stats, locale) {
  if (!Object.hasOwn(LIMITS, locale)) throw new Error(`Onbekend land: ${locale}`);
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) throw new Error("Stats moeten een object zijn");
  if (stats.schema_version !== 1) throw new Error("Onbekend of ontbrekend stats-schema");
  if (stats.locale !== locale) throw new Error("Stats horen bij een ander of ontbrekend land");
  if (!["completed", "partial"].includes(stats.crawl_status) || stats.phase !== "done") {
    throw new Error("Ontbrekende of ongeldige eindstatus");
  }
  if (typeof stats.finished_at !== "string" || !Number.isFinite(Date.parse(stats.finished_at))) {
    throw new Error("Ongeldige finished_at");
  }
  for (const key of [...METRICS.map((metric) => metric.key), "additional_parts", "error_count"]) {
    if (!Number.isSafeInteger(stats[key]) || stats[key] < 0) throw new Error(`Ongeldig of ontbrekend aantal: ${key}`);
  }
  if (!Number.isFinite(stats.product_success_rate) || stats.product_success_rate < 0 || stats.product_success_rate > 1) {
    throw new Error("Ongeldige product_success_rate");
  }
  if (stats.products > stats.product_urls || stats.parts > stats.products || stats.products_with_accessories > stats.products ||
      stats.marketplace_entries > stats.products + stats.additional_parts) {
    throw new Error("Onderling onmogelijke aantallen");
  }
  const coverage = stats.product_urls ? stats.products / stats.product_urls : 0;
  if (Math.abs(stats.product_success_rate - coverage) > 0.000051) throw new Error("Productdekking klopt niet met de aantallen");
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function isApprovedRun(run, locale) {
  try {
    validateStats(run, locale);
    return run.approved === true && ["ok", "alert"].includes(run.status) &&
      run.crawl_status === "completed" && run.error_count === 0 && run.products === run.product_urls;
  } catch {
    return false;
  }
}

export function evaluate(stats, history, locale) {
  validateStats(stats, locale);
  if (!Array.isArray(history)) throw new Error("Historie moet een lijst zijn");
  const usable = history.filter((run) => isApprovedRun(run, locale)).slice(-7);
  const rows = [];
  const problems = [];
  let block = false;
  let hardBlock = false;

  for (const metric of METRICS) {
    const current = stats[metric.key];
    const normal = usable.length ? median(usable.map((run) => run[metric.key])) : null;
    const previous = usable.at(-1)?.[metric.key] ?? null;
    const change = normal ? (current - normal) / normal : null;
    const previousChange = previous ? (current - previous) / previous : null;
    let level = "ok";
    for (const [reference, delta, label] of [[normal, change, "mediaan"], [previous, previousChange, "vorige goedgekeurde run"]]) {
      if (delta !== null && delta <= -0.1) {
        if (metric.critical && delta <= -0.3) level = "block";
        else if (level === "ok") level = "alert";
        problems.push(`${metric.label}: ${current} i.p.v. ${label} ${Math.round(reference)} (${Math.round(delta * 100)}%)`);
      }
    }
    if (level === "block") block = true;
    rows.push({ ...metric, current, normal, change, level });
  }

  const reject = (message) => { hardBlock = true; problems.push(message); };
  if (stats.crawl_status !== "completed" || stats.error_count !== 0 || stats.products !== stats.product_urls) {
    reject(`Crawl onvolledig: status=${stats.crawl_status}, fouten=${stats.error_count}, producten=${stats.products}/${stats.product_urls}`);
  }
  const limits = LIMITS[locale];
  for (const key of ["products", "product_urls", "parts", "marketplace_entries"]) {
    if (stats[key] < limits[key]) reject(`${key}: ${stats[key]} onder minimum ${limits[key]} voor ${locale}`);
  }
  if (stats.products - stats.parts < limits.regular_products) {
    reject(`Te weinig reguliere producten voor ${locale}: ${stats.products - stats.parts} (minimum ${limits.regular_products})`);
  }
  const marketplaceCoverage = stats.products ? stats.marketplace_entries / (stats.products + stats.additional_parts) : 0;
  if (marketplaceCoverage < limits.marketplace_coverage) {
    reject(`Marketplace-dekking voor ${locale}: ${Math.round(marketplaceCoverage * 100)}% (minimum ${limits.marketplace_coverage * 100}%)`);
  }
  return { rows, problems, block: block || hardBlock, hardBlock, baselineRuns: usable.length };
}
