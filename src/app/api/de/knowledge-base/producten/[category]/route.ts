import { NextResponse } from "next/server";
import { corsOptions, serveBlobFile } from "../../../../_lib/blob-proxy";

export const runtime = "edge";

const VALID_CATEGORIES = [
  "trampoline",
  "pools",
  "spielgerate",
  "sport",
  "getset",
  "sandkasten",
  "schaukel",
  "ersatzteile",
  "overig",
] as const;

type Category = (typeof VALID_CATEGORIES)[number];

function isValidCategory(value: string): value is Category {
  return (VALID_CATEGORIES as readonly string[]).includes(value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params;

  if (!isValidCategory(category)) {
    return NextResponse.json(
      {
        error: `Unbekannte Kategorie: ${category}`,
        valid: VALID_CATEGORIES,
      },
      { status: 404 }
    );
  }

  return serveBlobFile(
    `de/producten-${category}.json`,
    `Produkte-${category}`,
    request
  );
}

export async function OPTIONS() {
  return corsOptions();
}
