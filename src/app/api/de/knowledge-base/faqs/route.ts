import { corsOptions, serveBlobFile } from "../../../_lib/blob-proxy";

export const runtime = "edge";

export async function GET(request: Request) {
  return serveBlobFile("de/faqs.json", "FAQs", request);
}

export async function OPTIONS() {
  return corsOptions();
}
