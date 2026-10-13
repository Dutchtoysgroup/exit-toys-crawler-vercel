import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { evaluate, validateStats } from "./lib/crawl-health-evaluation.mjs";

const script = fileURLToPath(new URL("./crawl-health.mjs", import.meta.url));
const preload = fileURLToPath(new URL("./test-fixtures/health-register.mjs", import.meta.url));
const workflow = readFileSync(new URL("../.github/workflows/crawl.yml", import.meta.url), "utf8");
const steps = workflow.split(/^      - name: /m).slice(1);
const baseline = {
  schema_version: 1, phase: "done", crawl_status: "completed", error_count: 0,
  finished_at: "2026-10-13T04:00:00Z", additional_parts: 0,
  approved: true, status: "ok",
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
  if (stats !== null) writeFileSync(statsFile, typeof stats === "string" ? stats : JSON.stringify({ locale, ...stats }));
  writeFileSync(historyFile, typeof history === "string" ? history : JSON.stringify(history.map((run) => ({ locale, ...run }))));
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
      const result = runHealth(t, { locale, stats: { ...baseline, parts: 500 }, force: "true", mailFails });
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

  for (const force of ["false", "true"]) {
    for (const [name, stats] of Object.entries({
      "empty stats and history": {},
      "null count (JSON NaN)": { ...baseline, products: NaN },
      "zero products": { ...baseline, product_urls: 0, products: 0, parts: 0, marketplace_entries: 0, products_with_accessories: 0, product_success_rate: 0 },
      "partial status": { ...baseline, crawl_status: "partial" },
      "failed requests": { ...baseline, error_count: 1 },
      "unfinished phase": { ...baseline, phase: "generate" },
      "missing products despite completed status": { ...baseline, products: 2999, marketplace_entries: 2999, product_success_rate: 0.9997 },
      "small first feed": { ...baseline, product_urls: 200, products: 200, parts: 100, products_with_accessories: 0, marketplace_entries: 200 },
      "poor marketplace coverage": { ...baseline, marketplace_entries: 2000 },
      "wrong country": { ...baseline, locale: locale === "nl" ? "de" : "nl" },
    })) {
      test(`${locale}: ${name} has no ready approval (force=${force})`, (t) => {
        const result = runHealth(t, { locale, stats, history: [], force });
        assert.equal(result.status, 1);
        assert.notEqual(result.output.ready, "true");
        assert.equal(result.uploads, 0);
        assert.match(result.stderr, /::error::/);
      });
    }
  }

  test(`${locale}: healthy first run meets absolute floors without history`, (t) => {
    const result = runHealth(t, { locale, history: [] });
    assert.equal(result.status, 0);
    assert.equal(result.output.ready, "true");
    assert.match(result.stderr, /Geen geldige goedgekeurde historie/);
  });

  test(`${locale}: previous approved run catches a drop hidden by the median`, (t) => {
    const result = runHealth(t, {
      locale,
      history: [...Array(6).fill(baseline), { ...baseline, product_urls: 6000, products: 6000, marketplace_entries: 6000 }],
    });
    assert.equal(result.output.ready, "false");
    assert.equal(result.uploads, 0);
    assert.match(result.stderr, /vorige goedgekeurde run 6000/);
  });

  test(`${locale}: blocked, legacy, malformed and foreign history cannot replace approval`, () => {
    const valid = { ...baseline, locale };
    const high = { ...valid, product_urls: 6000, products: 6000, marketplace_entries: 6000 };
    const result = evaluate(valid, [high, { ...valid, approved: false, status: "blocked" },
      { ...valid, approved: undefined }, { ...valid, locale: "other" }, { ...valid, products: NaN }, null], locale);
    assert.equal(result.baselineRuns, 1);
    assert.equal(result.block, true);
  });

  test(`${locale}: long series of rejections retains the last approved baseline`, (t) => {
    const rejected = { ...baseline, parts: 1, approved: false, status: "blocked" };
    const result = runHealth(t, { locale, stats: rejected, history: [baseline, ...Array(65).fill(rejected)] });
    const saved = result.events[0].history;
    assert.equal(saved.length, 60);
    assert.equal(saved[0].approved, true);
    assert.equal(saved.at(-1).approved, false);
    assert.equal(evaluate({ ...baseline, locale }, saved, locale).baselineRuns, 1);
  });

  test(`${locale}: absolute floors and coverage are enforced at their boundaries`, () => {
    const valid = { ...baseline, locale, product_urls: 500, products: 500, parts: 100, marketplace_entries: 500 };
    assert.equal(evaluate(valid, [], locale).hardBlock, false);
    for (const change of [{ parts: 99 }, { marketplace_entries: 499 },
      { parts: 401 }, { product_urls: 499, products: 499, products_with_accessories: 499, marketplace_entries: 499 }]) {
      assert.equal(evaluate({ ...valid, ...change }, [], locale).hardBlock, true);
    }
    const coverage = { ...valid, product_urls: 1000, products: 1000, marketplace_entries: 900 };
    assert.equal(evaluate(coverage, [], locale).hardBlock, false);
    assert.equal(evaluate({ ...coverage, marketplace_entries: 899 }, [], locale).hardBlock, true);
  });
}

test("schema rejects missing fields, non-finite numbers, strings and inconsistent counts", () => {
  const valid = { ...baseline, locale: "nl" };
  for (const key of Object.keys(valid).filter((key) => !["approved", "status"].includes(key))) {
    const invalid = { ...valid };
    delete invalid[key];
    assert.throws(() => validateStats(invalid, "nl"), key);
  }
  for (const value of [NaN, Infinity, -Infinity, -1, 1.5, "3000", null, true]) {
    assert.throws(() => validateStats({ ...valid, products: value }, "nl"));
  }
  for (const change of [{ schema_version: 2 }, { finished_at: "invalid" }, { parts: 3001 },
    { products_with_accessories: 3001 }, { marketplace_entries: 3001 }, { product_urls: 100 },
    { product_success_rate: NaN }, { product_success_rate: 0.5 }]) {
    assert.throws(() => validateStats({ ...valid, ...change }, "nl"));
  }
  for (const value of [null, [], 1, "stats"]) assert.throws(() => validateStats(value, "nl"));
  assert.throws(() => evaluate(valid, {}, "nl"));
  assert.throws(() => evaluate(valid, [], "fr"));
});
