import { NextResponse } from "next/server";
import { corsOptions, serveBlobFile } from "../../../_lib/blob-proxy";

export const runtime = "edge";

const VALID_CATEGORIES = [
  "trampolines",
  "zwembaden",
  "speelhuisjes",
  "sport",
  "getset",
  "zandbak",
  "schommel",
  "onderdelen",
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
        error: `Onbekende categorie: ${category}`,
        valid: VALID_CATEGORIES,
      },
      { status: 404 }
    );
  }

  return serveBlobFile(`producten-${category}.json`, `producten-${category}`, request);
}

export async function OPTIONS() {
  return corsOptions();
}
