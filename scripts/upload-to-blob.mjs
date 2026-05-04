/**
 * Upload crawler output naar Vercel Blob Storage.
 *
 * Verwacht dat BLOB_READ_WRITE_TOKEN als environment variable is gezet.
 * Leest de knowledge base JSON bestanden uit /tmp/crawler-output-{locale}/.
 *
 * Ondersteunt CRAWLER_LOCALE env var (default: "nl").
 * - NL: upload als producten.json, faqs.json, etc. (ongewijzigd)
 * - DE: upload met de/ prefix: de/producten.json, de/faqs.json, etc.
 */

import { put } from "@vercel/blob";
import { readFileSync, statSync } from "fs";

const LOCALE = process.env.CRAWLER_LOCALE || "nl";
const OUTPUT_DIR = `/tmp/crawler-output-${LOCALE}`;
const BLOB_PREFIX = LOCALE === "nl" ? "" : `${LOCALE}/`;

// Categorie slugs per locale
const CATEGORY_SLUGS_NL = [
  "trampolines",
  "zwembaden",
  "speelhuisjes",
  "sport",
  "getset",
  "zandbak",
  "schommel",
  "onderdelen",
  "overig",
];

const CATEGORY_SLUGS_DE = [
  "trampoline",
  "pools",
  "spielgerate",
  "sport",
  "getset",
  "sandkasten",
  "schaukel",
  "ersatzteile",
  "overig",
];

const CATEGORY_SLUGS = LOCALE === "de" ? CATEGORY_SLUGS_DE : CATEGORY_SLUGS_NL;

const FILES = [
  { name: "exittoys_knowledge_base.json", key: "combined" },
  { name: "producten.json", key: "producten" },
  { name: "faqs.json", key: "faqs" },
  { name: "paginas.json", key: "paginas" },
  { name: "marketplace-producten.json", key: "marketplace" },
  ...CATEGORY_SLUGS.map((slug) => ({
    name: `producten-${slug}.json`,
    key: `producten-${slug}`,
  })),
];

async function main() {
  console.log(`Upload starten voor locale: ${LOCALE}`);
  console.log(`Output dir: ${OUTPUT_DIR}`);
  console.log(`Blob prefix: "${BLOB_PREFIX || "(geen)"}"`);

  const uploadResults = {};

  for (const { name, key } of FILES) {
    const filePath = `${OUTPUT_DIR}/${name}`;
    console.log(`Lezen: ${filePath}`);

    const data = readFileSync(filePath, "utf-8");
    const entries = JSON.parse(data);
    const sizeBytes = statSync(filePath).size;

    console.log(`  ${name}: ${entries.length} entries, ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`);

    const blobKey = `${BLOB_PREFIX}${name}`;
    console.log(`  Uploaden als: ${blobKey}`);
    const blob = await put(blobKey, data, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    console.log(`  URL: ${blob.url}`);

    uploadResults[key] = {
      entries: entries.length,
      fileSizeBytes: sizeBytes,
      fileSizeMB: (sizeBytes / (1024 * 1024)).toFixed(2),
      blobUrl: blob.url,
    };
  }

  // Tel entry-types uit het gecombineerde bestand
  const combinedPath = `${OUTPUT_DIR}/exittoys_knowledge_base.json`;
  const combinedData = JSON.parse(readFileSync(combinedPath, "utf-8"));

  // Bouw categoryFiles object uit upload results
  const categoryFiles = {};
  for (const slug of CATEGORY_SLUGS) {
    const key = `producten-${slug}`;
    if (uploadResults[key]) {
      categoryFiles[slug] = uploadResults[key];
    }
  }

  // Maak en upload metadata
  const metadata = {
    locale: LOCALE,
    lastUpdated: new Date().toISOString(),
    entries: {
      total: combinedData.length,
      producten: uploadResults.producten.entries,
      faqs: uploadResults.faqs.entries,
      paginas: uploadResults.paginas.entries,
    },
    fileSizeBytes: uploadResults.combined.fileSizeBytes,
    fileSizeMB: uploadResults.combined.fileSizeMB,
    blobUrl: uploadResults.combined.blobUrl,
    files: {
      producten: uploadResults.producten,
      faqs: uploadResults.faqs,
      paginas: uploadResults.paginas,
      marketplace: uploadResults.marketplace,
    },
    categoryFiles,
    categorySlugs: CATEGORY_SLUGS,
  };

  const metaBlobKey = `${BLOB_PREFIX}exittoys_metadata.json`;
  console.log(`Uploaden: ${metaBlobKey}`);
  const metaBlob = await put(
    metaBlobKey,
    JSON.stringify(metadata, null, 2),
    {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    }
  );
  console.log(`Metadata URL: ${metaBlob.url}`);

  console.log(`Upload voltooid voor locale: ${LOCALE}!`);
}

main().catch((err) => {
  console.error("Upload gefaald:", err);
  process.exit(1);
});
