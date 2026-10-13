import { corsOptions, serveBlobFile } from "../_lib/blob-proxy";

export const runtime = "edge";

export async function GET(request: Request) {
  return serveBlobFile("exittoys_knowledge_base.json", "kennisbank", request);
}

export async function OPTIONS() {
  return corsOptions();
}
