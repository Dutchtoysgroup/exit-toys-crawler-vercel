import { BlobNotFoundError, head } from "@vercel/blob";

export const CATEGORY_SLUGS = {
  nl: ["trampolines", "zwembaden", "speelhuisjes", "sport", "getset", "zandbak", "schommel", "onderdelen", "overig"],
  de: ["trampoline", "pools", "spielgerate", "sport", "getset", "sandkasten", "schaukel", "ersatzteile", "overig"],
};

export function feedFiles(locale) {
  if (!Object.hasOwn(CATEGORY_SLUGS, locale)) throw new Error(`Unsupported locale: ${locale}`);
  return [
    { name: "exittoys_knowledge_base.json", key: "combined" },
    { name: "producten.json", key: "producten" },
    { name: "faqs.json", key: "faqs" },
    { name: "paginas.json", key: "paginas" },
    { name: "marketplace-producten.json", key: "marketplace" },
    ...CATEGORY_SLUGS[locale].map((slug) => ({ name: `producten-${slug}.json`, key: `producten-${slug}` })),
  ];
}

export function generationPrefix(locale, generation) {
  feedFiles(locale);
  if (typeof generation !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(generation)) throw new Error("Invalid generation");
  return `generations/${locale}/${generation}/`;
}

export function manifestKey(locale) {
  feedFiles(locale);
  // Existing metadata location becomes the sole mutable publication pointer.
  return `${locale === "nl" ? "" : "de/"}exittoys_metadata.json`;
}

export function validateManifest(manifest, locale, origin) {
  if (manifest?.schemaVersion !== 1 || manifest.locale !== locale) throw new Error("Invalid feed manifest schema or locale");
  const prefix = generationPrefix(locale, manifest.generation);
  if (!Number.isSafeInteger(manifest.sourceRun?.number) || manifest.sourceRun.number < 1 ||
      !Number.isSafeInteger(manifest.sourceRun?.attempt) || manifest.sourceRun.attempt < 1) throw new Error("Invalid source run");
  for (const { name } of feedFiles(locale)) {
    const file = manifest.generationFiles?.[name];
    if (!file || file.pathname !== `${prefix}${name}` ||
        !Number.isSafeInteger(file.entries) || file.entries < 0 ||
        !Number.isSafeInteger(file.fileSizeBytes) || file.fileSizeBytes < 2 ||
        typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Invalid manifest file: ${name}`);
    const url = new URL(file.blobUrl);
    if (url.origin !== origin || url.pathname !== `/${file.pathname}` || url.search || url.hash || url.username || url.password) {
      throw new Error(`File outside manifest generation: ${name}`);
    }
  }
  return manifest;
}

/**
 * @typedef {object} ReaderOptions
 * @property {string | null} [generation]
 * @property {typeof head} [headBlob]
 * @property {typeof fetch} [fetchBlob]
 */

// Weak comparison (RFC 9110): the CDN serves a compressed body as W/"<tag>" of the same version.
function sameEtag(a, b) {
  const opaque = (tag) => (typeof tag === "string" ? tag.replace(/^W\//, "") : null);
  return opaque(a) !== null && opaque(a) === opaque(b);
}

/**
 * Read one pointer version; never combine a cached body with a newer ETag.
 * @param {string} locale
 * @param {ReaderOptions} [options]
 */
export async function readFeedManifest(locale, { generation = null, headBlob = head, fetchBlob = fetch } = {}) {
  const key = generation ? `${generationPrefix(locale, generation)}manifest.json` : manifestKey(locale);
  let blob;
  try {
    blob = await headBlob(key);
  } catch (error) {
    if (error instanceof BlobNotFoundError && !generation) return null;
    throw error;
  }
  if (!blob.etag) throw new Error("Manifest ETag missing");
  const url = new URL(blob.url);
  url.searchParams.set("version", blob.etag);
  const response = await fetchBlob(url.href, { cache: "no-store" });
  if (!response.ok || !sameEtag(response.headers.get("etag"), blob.etag)) throw new Error("Manifest unavailable or changed while reading");
  const manifest = await response.json();
  if (manifest?.schemaVersion !== undefined || manifest?.generation !== undefined || generation) {
    validateManifest(manifest, locale, new URL(blob.url).origin);
    if (generation && manifest.generation !== generation) throw new Error("Wrong pinned generation");
  } else if (!manifest || !Number.isSafeInteger(manifest.entries?.total)) {
    throw new Error("Invalid legacy metadata");
  }
  return { manifest, etag: blob.etag };
}

/**
 * Storage errors never fall back to legacy data after migration.
 * @param {string} blobFilename
 * @param {ReaderOptions} [options]
 */
export async function resolveFeedFile(blobFilename, { generation = null, headBlob = head, fetchBlob = fetch } = {}) {
  // The separately maintained bill of materials is not part of a crawl publication.
  if (blobFilename === "stuklijst.json") {
    if (generation) throw new Error("Stuklijst has no crawl generation");
    return { url: (await headBlob(blobFilename)).url, generation: null };
  }
  const locale = blobFilename.startsWith("de/") ? "de" : "nl";
  const name = blobFilename.replace(/^de\//, "");
  if (!feedFiles(locale).some((file) => file.name === name)) throw new Error("Unknown feed file");
  const snapshot = await readFeedManifest(locale, { generation, headBlob, fetchBlob });
  if (snapshot?.manifest.schemaVersion === 1) {
    return { url: snapshot.manifest.generationFiles[name].blobUrl, generation: snapshot.manifest.generation };
  }
  return { url: (await headBlob(blobFilename)).url, generation: null };
}
