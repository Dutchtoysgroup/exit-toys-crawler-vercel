import { corsOptions, serveBlobFile } from "../../../_lib/blob-proxy";

export const runtime = "edge";

export async function GET() {
  return serveBlobFile("de/marketplace-producten.json", "Marketplace Produkte");
}

export async function OPTIONS() {
  return corsOptions();
}
