import { corsOptions, serveBlobFile } from "../_lib/blob-proxy";

export const runtime = "edge";

export async function GET() {
  return serveBlobFile("stuklijst.json", "stuklijst");
}

export async function OPTIONS() {
  return corsOptions();
}
