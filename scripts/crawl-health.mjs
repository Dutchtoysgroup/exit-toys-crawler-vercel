/**
 * Health check na een crawl: vergelijkt de kerncijfers van deze run met wat normaal is
 * en mailt als er iets mis lijkt.
 *
 * Aanleiding: van 19 aug tot 17 sep 2026 ontbraken alle ~1.500 onderdelen in de feed
 * (exittoys verplaatste ze naar een nieuwe sitemap), terwijl elke run "success" meldde.
 *
 * Werking
 * - Leest /tmp/crawler-output-{locale}/crawl-stats.json (geschreven door main.py).
 * - Valideert schema, land, eindstatus, aantallen en dekking; absolute grenzen gelden
 *   ook zonder historie en kunnen niet met force_upload worden omzeild.
 * - Vergelijkt met de mediaan van de laatste 7 expliciet goedgekeurde runs én met de
 *   vorige goedgekeurde run, bewaard als health/crawl-history-{locale}.json in Vercel Blob.
 * - Een daling vanaf 10% geeft een melding; vanaf 30% op een kritiek cijfer wordt upload
 *   geblokkeerd. Alleen die relatieve daling kan met force_upload worden toegestaan.
 * - Alleen een afgeronde, toegestane beoordeling schrijft ready=true. Mail is optioneel.
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
import { evaluate, isApprovedRun } from "./lib/crawl-health-evaluation.mjs";

const LOCALE = process.env.CRAWLER_LOCALE || "nl";
const DRY_RUN = process.argv.includes("--dry-run");
const FAILURE_MODE = process.argv.includes("--failure");
const STATS_FILE = process.env.HEALTH_STATS_FILE || `/tmp/crawler-output-${LOCALE}/crawl-stats.json`;
const HISTORY_KEY = `health/crawl-history-${LOCALE}.json`;

const HISTORY_LIMIT = 60;

const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : "";

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
  // Ook na veel afkeuringen moet de vorige goedkeuring als referentie blijven staan.
  const recent = history.slice(-HISTORY_LIMIT);
  const approved = history.findLast((run) => isApprovedRun(run, LOCALE));
  if (approved && !recent.includes(approved)) recent.splice(0, 1, approved);
  await put(HISTORY_KEY, JSON.stringify(recent, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
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
        : "De nieuwe data is vrijgegeven voor upload."
    }</strong></p>
    <table style="border-collapse:collapse;margin:12px 0">
      <tr style="text-align:left;border-bottom:1px solid #d0d7de">
        <th style="padding:4px 12px 4px 0">Cijfer</th><th style="padding:4px 12px">Nu</th>
        <th style="padding:4px 12px">Normaal</th><th style="padding:4px 0 4px 12px">Verschil</th>
      </tr>${tableRows}
    </table>
    <p style="color:#59636e">"Normaal" is de mediaan van de laatste ${baselineRuns} goedgekeurde runs; ook de vorige goedgekeurde run wordt afzonderlijk vergeleken. Productpagina's: ${Math.round((stats.product_success_rate ?? 0) * 100)}% van de URL's gelezen.</p>
    ${runUrl ? `<p><a href="${runUrl}">Bekijk de run en de logs</a></p>` : ""}
    <p style="color:#59636e">${
      blocked
        ? "Herstel onvolledige of ongeldige crawls eerst. Alleen een relatieve assortimentsdaling boven de absolute minimumgrenzen kan met force_upload worden toegestaan."
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
  const { rows, problems, block, hardBlock, baselineRuns } = evaluate(stats, history, LOCALE);
  if (baselineRuns === 0) console.warn("::warning::Geen geldige goedgekeurde historie; absolute minimumgrenzen en dekking blijven verplicht");
  const forced = process.env.FORCE_UPLOAD === "true";
  const blocked = hardBlock || (block && !forced);

  console.log(`Health check ${LOCALE}: ${baselineRuns} runs als referentie`);
  for (const r of rows) {
    console.log(`  ${r.label}: ${r.current} (normaal ${r.normal === null ? "-" : Math.round(r.normal)}) [${r.level}]`);
  }

  const status = problems.length === 0 ? "ok" : blocked ? "blocked" : "alert";
  if (blocked) {
    console.error(`::error::Health check ${LOCALE}: upload tegengehouden. ${problems.join("; ")}`);
    process.exitCode = 1;
  }
  if (!DRY_RUN) {
    await saveHistory([...history, { ...stats, status, approved: !blocked, run_url: runUrl }]);
  }

  // Schrijf de beoordeling voordat optionele notificaties kunnen falen.
  // Bij een eerdere crash ontbreekt ready en houdt de workflow de upload tegen.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `ready=${!blocked}\n`);
  }

  if (problems.length) {
    const subject = `[EXIT crawler] ${LOCALE.toUpperCase()}: ${problems.length} afwijking${problems.length > 1 ? "en" : ""}${blocked ? " - upload tegengehouden" : ""}`;
    console.log(`::warning::${subject}`);
    try {
      await notify(subject, renderHealthEmail({ stats, rows, problems, blocked, baselineRuns }));
    } catch (err) {
      console.warn("::warning::Health-notificatie mislukt:", err);
    }
  } else {
    console.log("Alles binnen normale marges.");
  }
}

(FAILURE_MODE ? runFailureMode() : runHealthCheck()).catch((err) => {
  // Zonder expliciete vrijgave mag de workflow niets uploaden.
  console.error("::error::Health check gefaald:", err);
  process.exit(1);
});
