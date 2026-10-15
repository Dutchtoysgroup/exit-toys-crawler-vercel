import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BlobNotFoundError, BlobPreconditionFailedError } from "@vercel/blob";
import { NextResponse } from "next/server.js";
import ts from "typescript";
import { publishGeneration } from "./upload-to-blob.mjs";
import { CATEGORY_SLUGS, feedFiles, manifestKey, readFeedManifest, resolveFeedFile } from "../src/lib/feed-manifest.mjs";

function writeFeeds(dir, locale, version) {
  const product = { trigger: "product", content: `${version} product` };
  const faq = { trigger: "faq", content: `${version} answer` };
  const page = { trigger: "page", content: `${version} page` };
  const data = {
    "exittoys_knowledge_base.json": [product, faq, page], "producten.json": [product],
    "faqs.json": [faq], "paginas.json": [page],
    "marketplace-producten.json": [{ sku: "123", ean: "", title: "Product", content: `${version} marketplace` }],
    ...Object.fromEntries(CATEGORY_SLUGS[locale].map((slug, i) => [`producten-${slug}.json`, i === 0 ? [product] : []])),
  };
  for (const [name, entries] of Object.entries(data)) writeFileSync(join(dir, name), JSON.stringify(entries));
  return data;
}

function storage() {
  const blobs = new Map();
  const events = [];
  let sequence = 0;
  const store = {
    blobs, events, onPut: async () => {}, onFetch: null,
    seed(key, data) {
      blobs.set(key, { data: Buffer.from(data), etag: `"${++sequence}"` });
    },
    async headBlob(key) {
      events.push({ type: "head", key });
      const value = blobs.get(key);
      if (!value) throw new BlobNotFoundError();
      return { url: `https://test.public.blob.vercel-storage.com/${key}`, etag: value.etag };
    },
    async fetchBlob(url, options) {
      const key = new URL(url).pathname.slice(1);
      events.push({ type: "fetch", key, options });
      const override = await store.onFetch?.(key);
      if (override) return override;
      const value = blobs.get(key);
      return value ? new Response(value.data, { headers: { etag: value.etag } }) : new Response(null, { status: 404 });
    },
    async putBlob(key, data, options) {
      events.push({ type: "put", key, options });
      await store.onPut(key, data, options);
      const previous = blobs.get(key);
      if (options.ifMatch && previous?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      if (!options.allowOverwrite && previous) throw new Error("Blob already exists");
      store.seed(key, data);
      return { url: `https://test.public.blob.vercel-storage.com/${key}`, etag: blobs.get(key).etag };
    },
  };
  return store;
}

async function setup(t, locale, seed = true) {
  const outputDir = mkdtempSync(join(tmpdir(), "feed-publication-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));
  const store = storage();
  const args = { locale, outputDir, putBlob: store.putBlob, headBlob: store.headBlob, fetchBlob: store.fetchBlob };
  const oldData = writeFeeds(outputDir, locale, "old");
  const previous = seed ? await publishGeneration({ ...args, sourceRun: { number: 10, attempt: 1 } }) : null;
  const newData = writeFeeds(outputDir, locale, "new");
  store.events.length = 0;
  return { ...args, store, previous, oldData, newData, sourceRun: { number: 11, attempt: 1 } };
}

async function assertActive(context, generation, data) {
  for (const { name } of feedFiles(context.locale)) {
    const key = `${context.locale === "de" ? "de/" : ""}${name}`;
    const resolved = await resolveFeedFile(key, context);
    assert.equal(resolved.generation, generation);
    const response = await context.fetchBlob(resolved.url);
    assert.deepEqual(await response.json(), data[name]);
  }
}

for (const locale of ["nl", "de"]) {
  // Includes every feed, the immutable manifest, and the final pointer write.
  for (let failureAt = 1; failureAt <= feedFiles(locale).length + 2; failureAt++) {
    test(`${locale}: failure at write ${failureAt} leaves the entire previous generation active`, async (t) => {
      const context = await setup(t, locale);
      let writes = 0;
      context.store.onPut = async () => {
        if (++writes === failureAt) throw new Error("Injected upload failure");
      };
      await assert.rejects(publishGeneration(context), /Injected upload failure/);
      await assertActive(context, context.previous.generation, context.oldData);
    });
  }

  test(`${locale}: switch occurs only after all remote files and manifest are verified`, async (t) => {
    const context = await setup(t, locale);
    context.store.onPut = async (key) => {
      // Even immediately before the pointer write, readers see the complete old set.
      await assertActive(context, context.previous.generation, context.oldData);
      if (key === manifestKey(locale)) {
        const verified = context.store.events.filter((e) => e.type === "fetch" && e.key.includes("/11-"));
        assert.equal(verified.length, feedFiles(locale).length + 1);
      }
    };
    const current = await publishGeneration(context);
    await assertActive(context, current.generation, context.newData);
    const writes = context.store.events.filter((e) => e.type === "put");
    assert.equal(writes.at(-1).key, manifestKey(locale));
    assert.ok(writes.at(-1).options.ifMatch);
    assert.ok(writes.slice(0, -1).every((e) => e.key.startsWith(`generations/${locale}/`) && e.options.allowOverwrite === false));
    // A client that started before the switch can still fetch the same snapshot.
    const pinned = await resolveFeedFile(`${locale === "de" ? "de/" : ""}producten.json`, { ...context, generation: context.previous.generation });
    assert.deepEqual(await (await context.fetchBlob(pinned.url)).json(), context.oldData["producten.json"]);
  });

  for (const kind of ["missing", "corrupt", "manifest-corrupt"]) {
    test(`${locale}: ${kind} remote data cannot activate a generation`, async (t) => {
      const context = await setup(t, locale);
      context.store.onFetch = (key) => {
        if (!key.includes("/11-")) return null;
        if (kind === "manifest-corrupt") return key.endsWith("/manifest.json") ? new Response("{}") : null;
        if (!key.endsWith("/producten-overig.json")) return null;
        return kind === "missing" ? new Response(null, { status: 404 }) : new Response("[ ]");
      };
      await assert.rejects(publishGeneration(context), /unavailable|checksum|verification/);
      await assertActive(context, context.previous.generation, context.oldData);
      assert.equal(context.store.events.some((e) => e.type === "put" && e.key === manifestKey(locale)), false);
    });
  }

  test(`${locale}: stale run and old rerun cannot overwrite a newer publication`, async (t) => {
    const context = await setup(t, locale);
    for (const sourceRun of [{ number: 9, attempt: 99 }, { number: 10, attempt: 1 }]) {
      await assert.rejects(publishGeneration({ ...context, sourceRun }), /older or already published/);
    }
    assert.equal(context.store.events.some((e) => e.type === "put"), false);
    await assertActive(context, context.previous.generation, context.oldData);
    const retry = await publishGeneration({ ...context, sourceRun: { number: 10, attempt: 2 } });
    assert.equal(retry.sourceRun.attempt, 2);
  });

  for (const seed of [false, true]) {
    test(`${locale}: concurrent newer publication defeats a delayed older writer (existing=${seed})`, async (t) => {
      const context = await setup(t, locale, seed);
      let release;
      let announce;
      const paused = new Promise((resolve) => { announce = resolve; });
      const proceed = new Promise((resolve) => { release = resolve; });
      let waiting = false;
      context.store.onPut = async (key) => {
        if (key.includes("/11-") && !waiting) {
          waiting = true;
          announce();
          await proceed;
        }
      };
      const older = publishGeneration(context);
      await paused;
      const newer = await publishGeneration({ ...context, sourceRun: { number: 12, attempt: 1 } });
      release();
      await assert.rejects(older, seed ? BlobPreconditionFailedError : /already exists/);
      await assertActive(context, newer.generation, context.newData);
    });
  }

  test(`${locale}: legacy keys remain readable during migration and are never overwritten`, async (t) => {
    const context = await setup(t, locale, false);
    context.store.seed(manifestKey(locale), JSON.stringify({ entries: { total: 3 } }));
    for (const [name, data] of Object.entries(context.oldData)) context.store.seed(`${locale === "de" ? "de/" : ""}${name}`, JSON.stringify(data));
    await assertActive(context, null, context.oldData);
    const current = await publishGeneration(context);
    await assertActive(context, current.generation, context.newData);
    for (const [name, data] of Object.entries(context.oldData)) {
      const saved = context.store.blobs.get(`${locale === "de" ? "de/" : ""}${name}`);
      assert.deepEqual(JSON.parse(saved.data), data);
    }
  });

  test(`${locale}: CDN weak ETags of the same version are accepted`, async (t) => {
    const context = await setup(t, locale, false);
    context.store.seed(manifestKey(locale), JSON.stringify({ entries: { total: 3 } }));
    // Production CDN serves compressed bodies as W/"<tag>" while head() reports "<tag>".
    context.store.onFetch = (key) => {
      const value = context.store.blobs.get(key);
      return value ? new Response(value.data, { headers: { etag: `W/${value.etag}` } }) : null;
    };
    const current = await publishGeneration(context);
    await assertActive(context, current.generation, context.newData);
  });
}

for (const [name, mutate] of Object.entries({
  "missing final file": (dir) => rmSync(join(dir, "producten-overig.json")),
  "invalid JSON": (dir) => writeFileSync(join(dir, "producten-overig.json"), "["),
  "wrong JSON shape": (dir) => writeFileSync(join(dir, "producten-overig.json"), "{}"),
  "invalid entry": (dir) => writeFileSync(join(dir, "producten-overig.json"), '[{"trigger":"x"}]'),
  "inconsistent combined": (dir) => writeFileSync(join(dir, "exittoys_knowledge_base.json"), "[]"),
  "inconsistent categories": (dir) => writeFileSync(join(dir, "producten-overig.json"), '[{"trigger":"extra","content":"extra"}]'),
  "empty marketplace": (dir) => writeFileSync(join(dir, "marketplace-producten.json"), "[]"),
})) {
  test(`${name} fails local preflight before any writes`, async (t) => {
    const context = await setup(t, "nl");
    mutate(context.outputDir);
    await assert.rejects(publishGeneration(context));
    assert.equal(context.store.events.some((e) => e.type === "put"), false);
    await assertActive(context, context.previous.generation, context.oldData);
  });
}

test("reader rejects incomplete manifests and stale CDN bodies instead of falling back", async (t) => {
  const context = await setup(t, "nl");
  context.store.onFetch = (key) => key === manifestKey("nl") ? new Response(JSON.stringify(context.previous), { headers: { etag: '"stale"' } }) : null;
  await assert.rejects(resolveFeedFile("producten.json", context), /changed while reading/);
  context.store.onFetch = (key) => key === manifestKey("nl") ? new Response(JSON.stringify(context.previous), { headers: { etag: 'W/"stale"' } }) : null;
  await assert.rejects(resolveFeedFile("producten.json", context), /changed while reading/);
  context.store.onFetch = null;
  const broken = structuredClone(context.previous);
  delete broken.generationFiles["producten-overig.json"];
  context.store.seed(manifestKey("nl"), JSON.stringify(broken));
  await assert.rejects(resolveFeedFile("producten.json", context), /Invalid manifest file/);
  await assert.rejects(resolveFeedFile("producten.json", { ...context, generation: "../other" }), /Invalid generation/);
  await assert.rejects(resolveFeedFile("producten.json", { ...context, generation: "unknown" }), BlobNotFoundError);
});

test("storage outages are not mistaken for an absent initial manifest", async () => {
  await assert.rejects(readFeedManifest("nl", { headBlob: async () => { throw new Error("storage outage"); } }), /storage outage/);
});

test("stuklijst remains independent of crawl manifests", async () => {
  const store = storage();
  store.seed("stuklijst.json", "[]");
  const resolved = await resolveFeedFile("stuklijst.json", store);
  assert.equal(resolved.generation, null);
  assert.deepEqual(store.events, [{ type: "head", key: "stuklijst.json" }]);
});

test("workflow serializes publishers across refs; API disables independent caches", () => {
  const workflow = readFileSync(new URL("../.github/workflows/crawl.yml", import.meta.url), "utf8");
  assert.match(workflow, /concurrency:\n  group: exit-toys-feed-publication\n  cancel-in-progress: false/);
  const proxy = readFileSync(new URL("../src/app/api/_lib/blob-proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /"Cache-Control": "no-store"/);
  assert.match(proxy, /"X-Feed-Generation": file.generation/);
});

function loadProxy(context) {
  // Run the actual TypeScript response handler on Node 20 with only storage replaced.
  const source = readFileSync(new URL("../src/app/api/_lib/blob-proxy.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requireMock = (name) => {
    if (name === "next/server") return { NextResponse };
    if (name === "@/lib/feed-manifest.mjs") return { resolveFeedFile: (key, options) => resolveFeedFile(key, { ...context, ...options }) };
    throw new Error(`Unexpected import: ${name}`);
  };
  return new Function("require", "exports", "fetch", `${compiled}\nreturn exports;`)(requireMock, {}, context.fetchBlob);
}

test("API serves active generation without stale endpoint caches and honors pinned snapshots", async (t) => {
  const context = await setup(t, "nl");
  const current = await publishGeneration(context);
  const { serveBlobFile } = loadProxy(context);
  const response = await serveBlobFile("producten.json", "producten", new Request("https://api.example/api/knowledge-base/producten"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-feed-generation"), current.generation);
  assert.equal(response.headers.get("access-control-expose-headers"), "X-Feed-Generation");
  assert.deepEqual(await response.json(), context.newData["producten.json"]);
  const pinned = await serveBlobFile("producten.json", "producten", new Request(`https://api.example/api/knowledge-base/producten?generation=${context.previous.generation}`));
  assert.equal(pinned.headers.get("x-feed-generation"), context.previous.generation);
  assert.deepEqual(await pinned.json(), context.oldData["producten.json"]);
});

test("API rejects invalid or missing generations and does not mix in legacy files", async (t) => {
  const context = await setup(t, "nl");
  const { serveBlobFile } = loadProxy(context);
  const invalid = await serveBlobFile("producten.json", "producten", new Request("https://api.example/?generation=../other"));
  assert.equal(invalid.status, 400);
  const missing = await serveBlobFile("producten.json", "producten", new Request("https://api.example/?generation=missing"));
  assert.equal(missing.status, 503);
  context.store.seed("producten.json", JSON.stringify([{ trigger: "legacy", content: "legacy" }]));
  context.store.blobs.delete(context.previous.generationFiles["producten.json"].pathname);
  const unavailable = await serveBlobFile("producten.json");
  assert.equal(unavailable.status, 502);
});

test("every feed endpoint forwards the request for generation pinning", async () => {
  const { readdirSync } = await import("node:fs");
  const root = new URL("../src/app/api/", import.meta.url);
  for (const name of readdirSync(root, { recursive: true })) {
    if (!name.endsWith("route.ts")) continue;
    const source = readFileSync(new URL(name, root), "utf8");
    if (!source.includes("serveBlobFile")) continue;
    assert.match(source, /request: Request/, name);
    assert.match(source, /return serveBlobFile\([\s\S]*?,\s*request\s*\);/, name);
  }
});
