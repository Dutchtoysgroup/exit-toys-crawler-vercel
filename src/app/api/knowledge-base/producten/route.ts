import { corsOptions, serveBlobFile } from "../../_lib/blob-proxy";

export const runtime = "edge";

export async function GET(request: Request) {
  return serveBlobFile("producten.json", "producten", request);
}

export async function OPTIONS() {
  return corsOptions();
}
