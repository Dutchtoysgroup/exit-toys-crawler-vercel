import { corsOptions, serveBlobFile } from "../../_lib/blob-proxy";

export const runtime = "edge";

export async function GET() {
  return serveBlobFile("marketplace-producten.json", "marketplace producten");
}

export async function OPTIONS() {
  return corsOptions();
}
