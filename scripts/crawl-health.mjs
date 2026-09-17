/**
 * Health check na een crawl: vergelijkt de kerncijfers van deze run met wat normaal is
 * en mailt als er iets mis lijkt.
 *
 * Aanleiding: van 19 aug tot 17 sep 2026 ontbraken alle ~1.500 onderdelen in de feed
 * (exittoys verplaatste ze naar een nieuwe sitemap), terwijl elke run "success" meldde.
 *
 * Werking
 * - Leest /tmp/crawler-output-{locale}/crawl-stats.json (geschreven door main.py).
 * - "Normaal" = mediaan van de laatste 7 niet-tegengehouden runs, bewaard in Vercel Blob
 *   als health/crawl-history-{locale}.json.
 * - Daalt een cijfer 10% of meer onder normaal: e-mail.
 * - Daalt een kritiek cijfer (producten, onderdelen, feed) 30% of meer, of zijn er minder
 *   dan 100 onderdelen: e-mail én skip_upload=true, zodat de live feed van gisteren blijft staan.
 *   Een bewuste assortimentswijziging kun je forceren met workflow_dispatch force_upload.
 *
 * Gebruik
 *   CRAWLER_LOCALE=nl node scripts/crawl-health.mjs            health check
 *   node scripts/crawl-health.mjs --failure                    mail dat de run faalde
 *   ... --dry-run                                              niets opslaan of mailen
 *
 * Env: BLOB_READ_WRITE_TOKEN, ALERT_EMAIL_TO, MS_GRAPH_* (zie lib/graph-email.mjs),
 *      FORCE_UPLOAD, GITHUB_OUTPUT/GITHUB_SERVER_URL/GITHUB_REPOSITORY/GITHUB_RUN_ID
 */

import { appendFileSync, readFileSync } from "fs";
import { emailConfigured, sendEmail } from "./lib/graph-email.mjs";

const LOCALE = process.env.CRAWLER_LOCALE || "nl";
const DRY_RUN = process.argv.includes("--dry-run");
const FAILURE_MODE = process.argv.includes("--failure");
const STATS_FILE = process.env.HEALTH_STATS_FILE || `/tmp/crawler-output-${LOCALE}/crawl-stats.json`;
const HISTORY_KEY = `health/crawl-history-${LOCALE}.json`;

const BASELINE_RUNS = 7;
const HISTORY_LIMIT = 60;
const ALERT_DROP = 0.1;
const BLOCK_DROP = 0.3;
const MIN_SUCCESS_RATE = 0.9;
// In aug 2026 bleef er precies 1 onderdeel over; "0" als grens had dat niet gevangen.
const MIN_PARTS = 100;

const METRICS = [
  { key: "product_urls", label: "Product-URL's in sitemaps", critical: true },
  { key: "products", label: "Productpagina's gelezen", critical: true },
  { key: "parts", label: "Onderdelen", critical: true },
  { key: "marketplace_entries", label: "Items in marketplace-feed", critical: true },
  { key: "products_with_accessories", label: "Producten met accessoires", critical: false },
  { key: "faqs", label: "FAQ's", critical: false },
  { key: "pages", label: "Pagina's", critical: false },
  { key: "blogs", label: "Blogs", critical: false },
];

const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : "";

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function loadHistory() {
  // Lokaal testen zonder Blob: HEALTH_HISTORY_FILE=pad/naar/historie.json
  if (process.env.HEALTH_HISTORY_FILE) {
    return JSON.parse(readFileSync(process.env.HEALTH_HISTORY_FILE, "utf-8"));
  }
  // Dynamisch: --failure moet ook werken als npm ci nog niet gedraaid had.
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: HISTORY_KEY });
  const blob = blobs.find((b) => b.pathname === HISTORY_KEY);
  if (!blob) return [];
  const response = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Historie ophalen mislukt (${response.status})`);
  return response.json();
}

async function saveHistory(history) {
  const { put } = await import("@vercel/blob");
  await put(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT), null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

function evaluate(stats, history) {
  const usable = history.filter((run) => run.status !== "blocked").slice(-BASELINE_RUNS);
  const rows = [];
  const problems = [];
  let block = false;

  for (const metric of METRICS) {
    const current = stats[metric.key];
    const previous = usable.map((run) => run[metric.key]).filter((v) => typeof v === "number");
    const normal = previous.length ? median(previous) : null;
    const change = normal ? (current - normal) / normal : null;
    let level = "ok";
    if (change !== null && change <= -ALERT_DROP) {
      level = metric.critical && change <= -BLOCK_DROP ? "block" : "alert";
      problems.push(`${metric.label}: ${current} i.p.v. normaal ${Math.round(normal)} (${Math.round(change * 100)}%)`);
    }
    if (level === "block") block = true;
    rows.push({ ...metric, current, normal, change, level });
  }

  // Absolute ondergrenzen: gelden ook zonder historie (eerste run, of na een lange storing).
  if (typeof stats.parts === "number" && stats.parts < MIN_PARTS) {
    block = true;
    problems.push(`Onderdelen: slechts ${stats.parts} gevonden (normaal ~1.500)`);
  }
  if (typeof stats.product_success_rate === "number" && stats.product_success_rate < MIN_SUCCESS_RATE) {
    problems.push(
      `Slechts ${Math.round(stats.product_success_rate * 100)}% van de product-URL's leverde een productpagina op (${stats.products} van ${stats.product_urls})`,
    );
  }

  return { rows, problems, block, baselineRuns: usable.length };
}

function renderHealthEmail({ stats, rows, problems, blocked, baselineRuns }) {
  const fmtChange = (c) => (c === null ? "–" : `${c > 0 ? "+" : ""}${Math.round(c * 100)}%`);
  const color = { ok: "#1a7f37", alert: "#b35900", block: "#cf222e" };
  const tableRows = rows
    .map(
      (r) => `<tr>
        <td style="padding:4px 12px 4px 0">${escapeHtml(r.label)}</td>
        <td style="padding:4px 12px;text-align:right">${r.current ?? "–"}</td>
        <td style="padding:4px 12px;text-align:right">${r.normal === null ? "–" : Math.round(r.normal)}</td>
        <td style="padding:4px 0 4px 12px;text-align:right;color:${color[r.level]};font-weight:${r.level === "ok" ? "normal" : "bold"}">${fmtChange(r.change)}</td>
      </tr>`,
    )
    .join("");

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2328">
    <p>De crawl van <strong>exittoys.${LOCALE}</strong> wijkt af van normaal:</p>
    <ul>${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
    <p><strong>${
      blocked
        ? "De upload is tegengehouden: HALO en de API blijven de feed van de vorige geslaagde run gebruiken."
        : "De nieuwe data is wel geüpload."
    }</strong></p>
    <table style="border-collapse:collapse;margin:12px 0">
      <tr style="text-align:left;border-bottom:1px solid #d0d7de">
        <th style="padding:4px 12px 4px 0">Cijfer</th><th style="padding:4px 12px">Nu</th>
        <th style="padding:4px 12px">Normaal</th><th style="padding:4px 0 4px 12px">Verschil</th>
      </tr>${tableRows}
    </table>
    <p style="color:#59636e">"Normaal" is de mediaan van de laatste ${baselineRuns} runs. Productpagina's: ${Math.round((stats.product_success_rate ?? 0) * 100)}% van de URL's gelezen.</p>
    ${runUrl ? `<p><a href="${runUrl}">Bekijk de run en de logs</a></p>` : ""}
    <p style="color:#59636e">${
      blocked
        ? "Klopt de daling wel (bijvoorbeeld een bewust kleiner assortiment)? Start de workflow dan handmatig met force_upload aan."
        : "Veelvoorkomende oorzaken: een nieuwe of hernoemde sitemap op exittoys, gewijzigde HTML van productpagina's, of blokkades/rate limiting."
    }</p>
  </div>`;
}

async function notify(subject, html) {
  const to = process.env.ALERT_EMAIL_TO;
  if (DRY_RUN) {
    console.log(`[dry-run] Zou mailen naar ${to || "(ALERT_EMAIL_TO ontbreekt)"}: ${subject}`);
    console.log(html);
    return;
  }
  if (!to || !emailConfigured()) {
    console.warn("::warning::E-mail niet geconfigureerd (ALERT_EMAIL_TO / MS_GRAPH_*) - geen melding verstuurd");
    return;
  }
  await sendEmail({ to, subject, html });
  console.log(`Melding gemaild naar ${to}`);
}

async function runFailureMode() {
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:14px">
    <p>De dagelijkse crawler-run van de EXIT Toys kennisbank is <strong>mislukt</strong>.</p>
    <p>Wat al geüpload was blijft live staan; stappen na de fout (bijvoorbeeld de DE-crawl) zijn niet uitgevoerd.</p>
    ${runUrl ? `<p><a href="${runUrl}">Bekijk de run en de logs</a></p>` : ""}
  </div>`;
  await notify("[EXIT crawler] Run mislukt", html);
}

async function runHealthCheck() {
  const stats = JSON.parse(readFileSync(STATS_FILE, "utf-8"));
  const history = await loadHistory();
  const { rows, problems, block, baselineRuns } = evaluate(stats, history);
  const forced = process.env.FORCE_UPLOAD === "true";
  const blocked = block && !forced;

  console.log(`Health check ${LOCALE}: ${baselineRuns} runs als referentie`);
  for (const r of rows) {
    console.log(`  ${r.label}: ${r.current} (normaal ${r.normal === null ? "-" : Math.round(r.normal)}) [${r.level}]`);
  }

  const status = problems.length === 0 ? "ok" : blocked ? "blocked" : "alert";
  if (!DRY_RUN) {
    await saveHistory([...history, { ...stats, status, run_url: runUrl }]);
  }

  if (problems.length) {
    const subject = `[EXIT crawler] ${LOCALE.toUpperCase()}: ${problems.length} afwijking${problems.length > 1 ? "en" : ""}${blocked ? " - upload tegengehouden" : ""}`;
    console.log(`::warning::${subject}`);
    await notify(subject, renderHealthEmail({ stats, rows, problems, blocked, baselineRuns }));
  } else {
    console.log("Alles binnen normale marges.");
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `skip_upload=${blocked}\n`);
  }
}

(FAILURE_MODE ? runFailureMode() : runHealthCheck()).catch((err) => {
  // Een kapotte health check mag de upload nooit blokkeren: skip_upload blijft dan leeg.
  console.error("::warning::Health check gefaald:", err);
  process.exit(1);
});
