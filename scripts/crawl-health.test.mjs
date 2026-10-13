import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./crawl-health.mjs", import.meta.url));
const preload = fileURLToPath(new URL("./test-fixtures/health-register.mjs", import.meta.url));
const workflow = readFileSync(new URL("../.github/workflows/crawl.yml", import.meta.url), "utf8");
const steps = workflow.split(/^      - name: /m).slice(1);
const baseline = {
  product_urls: 3000, products: 3000, parts: 1500, marketplace_entries: 3000,
  products_with_accessories: 500, faqs: 100, pages: 100, blogs: 100,
  product_success_rate: 1,
};

function runHealth(t, { locale, stats = baseline, history = [baseline], force = "false", mailFails = false, historyFails = false }) {
  const dir = mkdtempSync(join(tmpdir(), "crawl-health-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const statsFile = join(dir, "stats.json");
  const historyFile = join(dir, "history.json");
  const outputFile = join(dir, "output");
  const eventsFile = join(dir, "events.jsonl");
  if (stats !== null) writeFileSync(statsFile, typeof stats === "string" ? stats : JSON.stringify(stats));
  writeFileSync(historyFile, typeof history === "string" ? history : JSON.stringify(history));
  writeFileSync(outputFile, "");
  writeFileSync(eventsFile, "");
  const result = spawnSync(process.execPath, ["--import", preload, script], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      CRAWLER_LOCALE: locale,
      HEALTH_STATS_FILE: statsFile,
      HEALTH_HISTORY_FILE: historyFile,
      GITHUB_OUTPUT: outputFile,
      FORCE_UPLOAD: force,
      ALERT_EMAIL_TO: "test@example.invalid",
      TEST_EVENTS_FILE: eventsFile,
      TEST_MAIL_FAILURE: String(mailFails),
      TEST_HISTORY_FAILURE: String(historyFails),
    },
  });
  assert.ifError(result.error);
  const output = Object.fromEntries(readFileSync(outputFile, "utf8").trim().split("\n").filter(Boolean).map((line) => line.split("=")));
  const events = readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

  // Check the actual workflow gates, including Actions' implicit success() guard.
  const healthStep = steps.find((step) => step.startsWith(`Health check (${locale.toUpperCase()})\n`));
  const uploadStep = steps.find((step) => step.startsWith(`Upload to Vercel Blob (${locale.toUpperCase()})\n`));
  assert.ok(healthStep);
  assert.doesNotMatch(healthStep, /continue-on-error/);
  assert.match(healthStep, /run: node scripts\/crawl-health\.mjs/);
  assert.equal(uploadStep?.match(/^        if: (.+)$/m)?.[1], `steps.health_${locale}.outputs.ready == 'true'`);
  const uploads = result.status === 0 && output.ready === "true" ? 1 : 0;
  return { ...result, output, events, uploads };
}

for (const locale of ["nl", "de"]) {
  test(`${locale}: rejected crawl with failing mail blocks upload and fails visibly`, (t) => {
    const result = runHealth(t, { locale, stats: { ...baseline, parts: 1 }, mailFails: true });
    assert.equal(result.status, 1);
    assert.equal(result.output.ready, "false");
    assert.equal(result.uploads, 0);
    assert.match(result.stderr, /::error::.*upload tegengehouden/);
    assert.match(result.stderr, /::warning::Health-notificatie mislukt/);
    assert.equal(result.events.find((e) => e.type === "mail").output, "ready=false\n");
    assert.equal(result.events[0].history.at(-1).status, "blocked");
  });

  test(`${locale}: rejected crawl also fails when mail succeeds`, (t) => {
    const result = runHealth(t, { locale, stats: { ...baseline, parts: 500 } });
    assert.equal(result.status, 1);
    assert.equal(result.output.ready, "false");
    assert.equal(result.uploads, 0);
  });

  test(`${locale}: healthy crawl is explicitly ready`, (t) => {
    const result = runHealth(t, { locale });
    assert.equal(result.status, 0);
    assert.equal(result.output.ready, "true");
    assert.equal(result.uploads, 1);
    assert.equal(result.events.some((e) => e.type === "mail"), false);
  });

  test(`${locale}: warning-only crawl stays ready if mail fails`, (t) => {
    const result = runHealth(t, { locale, stats: { ...baseline, parts: 1200 }, mailFails: true });
    assert.equal(result.status, 0);
    assert.equal(result.output.ready, "true");
    assert.equal(result.uploads, 1);
    assert.match(result.stderr, /Health-notificatie mislukt/);
  });

  for (const mailFails of [false, true]) {
    test(`${locale}: explicit force allows rejected crawl (mail failure: ${mailFails})`, (t) => {
      const result = runHealth(t, { locale, stats: { ...baseline, parts: 1 }, force: "true", mailFails });
      assert.equal(result.status, 0);
      assert.equal(result.output.ready, "true");
      assert.equal(result.uploads, 1);
      assert.equal(result.events.find((e) => e.type === "mail").output, "ready=true\n");
      assert.equal(result.events[0].history.at(-1).status, "alert");
    });
  }

  for (const force of ["false", "true"]) {
    for (const [name, failure] of Object.entries({
      "missing stats": { stats: null },
      "invalid stats JSON": { stats: "{" },
      "invalid history JSON": { history: "{" },
      "history write failure": { historyFails: true },
    })) {
      test(`${locale}: ${name} blocks upload even with force=${force}`, (t) => {
        const result = runHealth(t, { locale, force, ...failure });
        assert.equal(result.status, 1);
        assert.equal(result.output.ready, undefined);
        assert.equal(result.uploads, 0);
        assert.match(result.stderr, /::error::Health check gefaald/);
      });
    }
  }
}
