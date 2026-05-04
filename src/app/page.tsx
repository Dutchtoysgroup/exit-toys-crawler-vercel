import { head } from "@vercel/blob";
import TriggerCrawlButton from "./components/TriggerCrawlButton";

interface FileInfo {
  entries: number;
  fileSizeBytes: number;
  fileSizeMB: string;
  blobUrl: string;
}

interface MarketplaceEntry {
  sku: string;
  ean: string;
  title: string;
  content: string;
}

interface KBMetadata {
  locale?: string;
  lastUpdated: string;
  entries: {
    total: number;
    producten?: number;
    faqs?: number;
    paginas?: number;
    products?: number;
    blogs?: number;
    pages?: number;
  };
  fileSizeBytes: number;
  fileSizeMB: string;
  files?: {
    producten: FileInfo;
    faqs: FileInfo;
    paginas: FileInfo;
    marketplace?: FileInfo;
  };
  categoryFiles?: Record<string, FileInfo>;
  categorySlugs?: string[];
}

const BASE_URL = "https://exit-toys-crawler-vercel.vercel.app";

const CATEGORY_LABELS_NL: Record<string, string> = {
  trampolines: "Trampolines",
  zwembaden: "Zwembaden",
  speelhuisjes: "Speelhuisjes",
  sport: "Sport",
  getset: "GetSet",
  zandbak: "Zandbak",
  schommel: "Schommel",
  onderdelen: "Onderdelen",
  overig: "Overig",
};

const CATEGORY_LABELS_DE: Record<string, string> = {
  trampoline: "Trampoline",
  pools: "Pools",
  spielgerate: "Spielgeräte",
  sport: "Sport",
  getset: "GetSet",
  sandkasten: "Sandkasten",
  schaukel: "Schaukel",
  ersatzteile: "Ersatzteile",
  overig: "Sonstige",
};

function normalizeEntries(entries: KBMetadata["entries"]) {
  return {
    total: entries.total,
    producten: entries.producten ?? entries.products ?? 0,
    faqs: entries.faqs ?? 0,
    paginas: entries.paginas ?? ((entries.blogs ?? 0) + (entries.pages ?? 0)),
  };
}

async function getMetadata(blobKey: string): Promise<KBMetadata | null> {
  try {
    const blobMeta = await head(blobKey);
    const response = await fetch(blobMeta.url, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  });
}

export default async function Dashboard() {
  const metaNL = await getMetadata("exittoys_metadata.json");
  const metaDE = await getMetadata("de/exittoys_metadata.json");

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 font-[family-name:var(--font-sans)]">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900">
          EXIT Toys Kennisbank
        </h1>
        <p className="mt-2 text-gray-600">
          Automatische crawler voor de CM Halo AI-chatbot kennisbank (NL + DE).
        </p>
      </div>

      {/* Handmatig crawlen */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Crawl starten</h2>
        </div>
        <p className="mb-4 text-sm text-gray-500">
          Start handmatig een crawl om de kennisbank direct bij te werken.
          Dit crawlt zowel exittoys.nl als exittoys.de.
        </p>
        <TriggerCrawlButton />

        {/* Robin sync reminder */}
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <span className="mt-0.5 text-amber-600 text-lg leading-none">&#9888;</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Vergeet niet: Robin synchroniseren na een handmatige crawl
              </p>
              <p className="mt-1 text-sm text-amber-700">
                Na een handmatige crawl moet je ook in <strong>Robin</strong> de kennisbank synchroniseren.
                Ga naar <strong>Robin &gt; Knowledge</strong> en klik op de{" "}
                <strong>&ldquo;Sync&rdquo;</strong>-knop. Bij de dagelijkse crawl (06:00)
                gebeurt dit automatisch.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Marketplace Informatie */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Marketplace Informatie</h2>
        <p className="mb-4 text-sm text-gray-500">
          Productfeed met SKU, EAN, titel en volledige productinhoud.
          Gebruikt dezelfde crawl-data als de kennisbank.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* NL Marketplace */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span>🇳🇱</span>
              <h3 className="font-medium text-gray-900">NL — exittoys.nl</h3>
            </div>
            {metaNL?.files?.marketplace ? (
              <p className="mb-3 text-sm text-gray-500">
                {metaNL.files.marketplace.entries.toLocaleString("nl-NL")} producten &middot;{" "}
                {metaNL.files.marketplace.fileSizeMB} MB
              </p>
            ) : (
              <p className="mb-3 text-sm text-yellow-600">Nog geen data (eerste crawl moet draaien)</p>
            )}
            <div className="rounded-md bg-gray-900 px-3 py-2 overflow-x-auto">
              <code className="text-sm text-green-400 font-[family-name:var(--font-mono)]">
                GET {BASE_URL}/api/marketplace/producten
              </code>
            </div>
          </div>

          {/* DE Marketplace */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span>🇩🇪</span>
              <h3 className="font-medium text-gray-900">DE — exittoys.de</h3>
            </div>
            {metaDE?.files?.marketplace ? (
              <p className="mb-3 text-sm text-gray-500">
                {metaDE.files.marketplace.entries.toLocaleString("nl-NL")} producten &middot;{" "}
                {metaDE.files.marketplace.fileSizeMB} MB
              </p>
            ) : (
              <p className="mb-3 text-sm text-yellow-600">Nog geen data (eerste crawl moet draaien)</p>
            )}
            <div className="rounded-md bg-gray-900 px-3 py-2 overflow-x-auto">
              <code className="text-sm text-green-400 font-[family-name:var(--font-mono)]">
                GET {BASE_URL}/api/de/marketplace/producten
              </code>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">
            Retourneert een JSON array met per product:{" "}
            <code className="rounded bg-gray-200 px-1 py-0.5 font-[family-name:var(--font-mono)]">sku</code>,{" "}
            <code className="rounded bg-gray-200 px-1 py-0.5 font-[family-name:var(--font-mono)]">ean</code>,{" "}
            <code className="rounded bg-gray-200 px-1 py-0.5 font-[family-name:var(--font-mono)]">title</code>,{" "}
            <code className="rounded bg-gray-200 px-1 py-0.5 font-[family-name:var(--font-mono)]">content</code>
          </p>
        </div>
      </div>

      {/* NL Sectie */}
      <LocaleSection
        locale="NL"
        flag="🇳🇱"
        site="exittoys.nl"
        meta={metaNL}
        apiPrefix="/api/knowledge-base"
        categoryLabels={CATEGORY_LABELS_NL}
      />

      {/* DE Sectie */}
      <LocaleSection
        locale="DE"
        flag="🇩🇪"
        site="exittoys.de"
        meta={metaDE}
        apiPrefix="/api/de/knowledge-base"
        categoryLabels={CATEGORY_LABELS_DE}
      />

      {/* Pipeline uitleg */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Crawl Pipeline</h2>
        <ol className="space-y-3 text-sm text-gray-700">
          <PipelineStep
            step={1}
            title="GitHub Actions"
            description="Dagelijks om 06:00 NL start de crawler automatisch."
          />
          <PipelineStep
            step={2}
            title="Website crawlen"
            description="Python crawler haalt alle producten, FAQs, blogs en pagina's op van exittoys.nl en exittoys.de."
          />
          <PipelineStep
            step={3}
            title="Kennisbank genereren"
            description="Data wordt omgezet naar trigger/content format per locale."
          />
          <PipelineStep
            step={4}
            title="Upload naar Blob Storage"
            description="Alle JSON bestanden worden geupload naar Vercel Blob Storage (NL + DE apart)."
          />
          <PipelineStep
            step={5}
            title="CM Halo sync"
            description="CM Halo haalt de kennisbank op via de individuele endpoints per taal."
          />
          <PipelineStep
            step={6}
            title="Robin synchroniseren"
            description="Bij een handmatige crawl: ga naar Robin > Knowledge en klik op 'Sync'. Bij de dagelijkse crawl gebeurt dit automatisch."
          />
        </ol>
      </div>
    </main>
  );
}

function LocaleSection({
  locale,
  flag,
  site,
  meta,
  apiPrefix,
  categoryLabels,
}: {
  locale: string;
  flag: string;
  site: string;
  meta: KBMetadata | null;
  apiPrefix: string;
  categoryLabels: Record<string, string>;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-4 text-xl font-bold text-gray-800">
        {flag} {locale} &mdash; {site}
      </h2>

      {meta ? (
        <>
          {/* Stats grid */}
          {(() => {
            const e = normalizeEntries(meta.entries);
            return (
              <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Totaal entries" value={e.total} />
                <StatCard label="Producten" value={e.producten} />
                <StatCard label="FAQs" value={e.faqs} />
                <StatCard label="Pagina&apos;s" value={e.paginas} />
              </div>
            );
          })()}

          {/* Info cards */}
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <InfoCard
              label="Laatste update"
              value={formatDate(meta.lastUpdated)}
            />
            <InfoCard label="Totale grootte" value={`${meta.fileSizeMB} MB`} />
          </div>

          {/* Per-bestand grootte */}
          {meta.files && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-3 text-base font-semibold">Bestanden</h3>
              <div className="space-y-2 text-sm">
                {[
                  { label: "producten.json", info: meta.files.producten },
                  { label: "faqs.json", info: meta.files.faqs },
                  { label: "paginas.json", info: meta.files.paginas },
                ].map(({ label, info }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-md bg-gray-50 px-4 py-2"
                  >
                    <code className="text-xs font-[family-name:var(--font-mono)]">
                      {label}
                    </code>
                    <span className="text-gray-500">
                      {info.entries.toLocaleString("nl-NL")} entries &middot;{" "}
                      {info.fileSizeMB} MB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Producten per categorie */}
          {meta.categoryFiles && Object.keys(meta.categoryFiles).length > 0 && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-3 text-base font-semibold">Producten per categorie</h3>
              <div className="space-y-2 text-sm">
                {Object.entries(meta.categoryFiles).map(([slug, info]) => (
                  <div
                    key={slug}
                    className="flex items-center justify-between rounded-md bg-gray-50 px-4 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-700">
                        {categoryLabels[slug] ?? slug}
                      </span>
                      <code className="text-xs text-gray-400 font-[family-name:var(--font-mono)]">
                        producten-{slug}.json
                      </code>
                    </div>
                    <span className="text-gray-500">
                      {info.entries.toLocaleString("nl-NL")} entries &middot;{" "}
                      {info.fileSizeMB} MB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-6">
          <p className="font-medium text-yellow-800">
            Nog geen {locale} data beschikbaar
          </p>
          <p className="mt-1 text-sm text-yellow-700">
            De eerste crawl voor {site} moet nog draaien.
          </p>
        </div>
      )}

      {/* API endpoints */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-3 text-base font-semibold">API Endpoints ({locale})</h3>
        <div className="space-y-2">
          {[
            {
              endpoint: `${BASE_URL}${apiPrefix}`,
              desc: "Volledige kennisbank (alle entries)",
            },
            {
              endpoint: `${BASE_URL}${apiPrefix}/producten`,
              desc: "Alle producten",
            },
            {
              endpoint: `${BASE_URL}${apiPrefix}/faqs`,
              desc: "Veelgestelde vragen",
            },
            {
              endpoint: `${BASE_URL}${apiPrefix}/paginas`,
              desc: "Pagina's + blogs",
            },
          ].map(({ endpoint, desc }) => (
            <div key={endpoint}>
              <div className="rounded-md bg-gray-900 px-4 py-2 overflow-x-auto">
                <code className="text-sm text-green-400 font-[family-name:var(--font-mono)]">
                  GET {endpoint}
                </code>
              </div>
              <p className="mt-1 mb-3 text-xs text-gray-500">{desc}</p>
            </div>
          ))}
        </div>

        <h4 className="mt-4 mb-2 text-sm font-semibold text-gray-700">Per categorie</h4>
        <div className="space-y-2">
          {Object.entries(categoryLabels).map(([slug, label]) => (
            <div key={slug}>
              <div className="rounded-md bg-gray-900 px-4 py-2 overflow-x-auto">
                <code className="text-sm text-green-400 font-[family-name:var(--font-mono)]">
                  GET {BASE_URL}{apiPrefix}/producten/{slug}
                </code>
              </div>
              <p className="mt-1 mb-3 text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>

        <p className="mt-2 text-sm text-gray-600">
          Retourneert JSON arrays met{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-[family-name:var(--font-mono)]">
            trigger
          </code>{" "}
          en{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-[family-name:var(--font-mono)]">
            content
          </code>{" "}
          velden. Compatibel met CM Halo API Connection.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-2xl font-bold text-gray-900">
        {value.toLocaleString("nl-NL")}
      </p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 font-medium text-gray-900">{value}</p>
    </div>
  );
}

function PipelineStep({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
        {step}
      </span>
      <div>
        <span className="font-medium text-gray-900">{title}</span>
        <span className="text-gray-500"> &mdash; {description}</span>
      </div>
    </li>
  );
}
