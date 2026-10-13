import { corsOptions, serveBlobFile } from "../../_lib/blob-proxy";

export const runtime = "edge";

export async function GET(request: Request) {
  return serveBlobFile("de/exittoys_knowledge_base.json", "Wissensdatenbank", request);
}

export async function OPTIONS() {
  return corsOptions();
}
