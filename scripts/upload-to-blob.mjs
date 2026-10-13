/** Publish a validated immutable generation, then atomically switch its manifest. */
import { put, head } from "@vercel/blob";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CATEGORY_SLUGS, feedFiles, generationPrefix, manifestKey, readFeedManifest, validateManifest } from "../src/lib/feed-manifest.mjs";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const entryKey = (entry) => JSON.stringify([entry.trigger, entry.content]);

function assertSameEntries(actual, expected, label) {
  const a = actual.map(entryKey).sort();
  const b = expected.map(entryKey).sort();
  if (a.length !== b.length || a.some((entry, i) => entry !== b[i])) throw new Error(`${label}: inconsistent feed contents`);
}

export function prepareFiles(outputDir, locale) {
  // Complete local preflight before the first upload, including the last category.
  const files = feedFiles(locale).map((file) => {
    const data = readFileSync(join(outputDir, file.name));
    const entries = JSON.parse(data.toString("utf8"));
    if (!Array.isArray(entries)) throw new Error(`${file.name}: expected array`);
    const fields = file.key === "marketplace" ? ["sku", "ean", "title", "content"] : ["trigger", "content"];
    const identities = new Set();
    for (const entry of entries) {
      if (!entry || fields.some((field) => typeof entry[field] !== "string") ||
          !entry.content.trim() || (file.key === "marketplace" ? !entry.sku.trim() || !entry.title.trim() : !entry.trigger.trim())) {
        throw new Error(`${file.name}: invalid entry`);
      }
      // Combined feeds may contain identical triggers from different content types.
      const identity = file.key === "marketplace" ? entry.sku : entry.trigger;
      if (file.key !== "combined" && identities.has(identity)) throw new Error(`${file.name}: duplicate entry`);
      identities.add(identity);
    }
    return { ...file, data, entries, fileSizeBytes: data.length, sha256: sha256(data) };
  });
  const byKey = Object.fromEntries(files.map((file) => [file.key, file]));
  if (!byKey.producten.entries.length || !byKey.marketplace.entries.length) throw new Error("Empty product feed");
  assertSameEntries(byKey.combined.entries, [...byKey.producten.entries, ...byKey.faqs.entries, ...byKey.paginas.entries], "Combined feed");
  assertSameEntries(CATEGORY_SLUGS[locale].flatMap((slug) => byKey[`producten-${slug}`].entries), byKey.producten.entries, "Category feeds");
  return files;
}

function assertNewer(sourceRun, current) {
  if (!Number.isSafeInteger(sourceRun?.number) || sourceRun.number < 1 ||
      !Number.isSafeInteger(sourceRun?.attempt) || sourceRun.attempt < 1) throw new Error("Valid workflow run number and attempt required");
  if (current && (sourceRun.number < current.number ||
      (sourceRun.number === current.number && sourceRun.attempt <= current.attempt))) throw new Error("Refusing older or already published workflow run");
}

export async function publishGeneration({ locale, outputDir, sourceRun, putBlob = put, headBlob = head, fetchBlob = fetch }) {
  const files = prepareFiles(outputDir, locale);
  const previous = await readFeedManifest(locale, { headBlob, fetchBlob });
  assertNewer(sourceRun, previous?.manifest.sourceRun);
  const generation = `${sourceRun.number}-${sourceRun.attempt}-${randomUUID()}`;
  const prefix = generationPrefix(locale, generation);
  const generationFiles = {};
  const results = {};
  for (const file of files) {
    const pathname = `${prefix}${file.name}`;
    const blob = await putBlob(pathname, file.data, {
      access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false,
    });
    results[file.key] = generationFiles[file.name] = {
      pathname, entries: file.entries.length, fileSizeBytes: file.fileSizeBytes,
      fileSizeMB: (file.fileSizeBytes / (1024 * 1024)).toFixed(2), blobUrl: blob.url, sha256: file.sha256,
    };
  }

  // Verify every remote byte before exposing any uploaded file through the API.
  for (const file of files) {
    const response = await fetchBlob(generationFiles[file.name].blobUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`${file.name}: uploaded file unavailable (${response.status})`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== file.fileSizeBytes || sha256(data) !== file.sha256) throw new Error(`${file.name}: uploaded file checksum mismatch`);
  }

  const manifest = {
    schemaVersion: 1, locale, generation, sourceRun, lastUpdated: new Date().toISOString(), generationFiles,
    entries: { total: results.combined.entries, producten: results.producten.entries, faqs: results.faqs.entries, paginas: results.paginas.entries },
    fileSizeBytes: results.combined.fileSizeBytes, fileSizeMB: results.combined.fileSizeMB, blobUrl: results.combined.blobUrl,
    files: { producten: results.producten, faqs: results.faqs, paginas: results.paginas, marketplace: results.marketplace },
    categoryFiles: Object.fromEntries(CATEGORY_SLUGS[locale].map((slug) => [slug, results[`producten-${slug}`]])),
    categorySlugs: CATEGORY_SLUGS[locale],
  };
  validateManifest(manifest, locale, new URL(results.combined.blobUrl).origin);
  const manifestData = JSON.stringify(manifest, null, 2);
  // Immutable manifest allows readers to pin multiple requests to one generation.
  const archived = await putBlob(`${prefix}manifest.json`, manifestData, {
    access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false,
  });
  const archivedResponse = await fetchBlob(archived.url, { cache: "no-store" });
  if (!archivedResponse.ok || await archivedResponse.text() !== manifestData) throw new Error("Generation manifest verification failed");

  // The only mutable write. A competing publisher invalidates this ETag; no blind retry.
  await putBlob(manifestKey(locale), manifestData, {
    access: "public", contentType: "application/json", addRandomSuffix: false, cacheControlMaxAge: 60,
    allowOverwrite: Boolean(previous), ...(previous ? { ifMatch: previous.etag } : {}),
  });
  console.log(`Published ${locale} generation ${generation}: ${files.length} verified files`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const locale = process.env.CRAWLER_LOCALE || "nl";
  publishGeneration({
    locale, outputDir: `/tmp/crawler-output-${locale}`,
    sourceRun: { number: Number(process.env.GITHUB_RUN_NUMBER), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
  }).catch((error) => {
    console.error("::error::Feed publication failed:", error);
    process.exitCode = 1;
  });
}
