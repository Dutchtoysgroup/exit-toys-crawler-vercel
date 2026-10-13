import { resolveFeedFile } from "@/lib/feed-manifest.mjs";
import { NextResponse } from "next/server";

/**
 * Serve een JSON bestand uit Vercel Blob Storage met CORS headers.
 */
export async function serveBlobFile(
  blobFilename: string,
  errorLabel: string = "data",
  request?: Request
) {
  try {
    const generation = request ? new URL(request.url).searchParams.get("generation") : null;
    if (generation !== null && !/^[a-zA-Z0-9-]{1,100}$/.test(generation)) {
      return NextResponse.json({ error: "Ongeldige generatie" }, { status: 400 });
    }
    const file = await resolveFeedFile(blobFilename, { generation });
    const blobResponse = await fetch(file.url, { cache: "no-store" });

    if (!blobResponse.ok) {
      return NextResponse.json(
        { error: `Kon ${errorLabel} niet laden vanuit storage` },
        { status: 502 }
      );
    }

    return new NextResponse(blobResponse.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Independent endpoint caches could keep different generations active.
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Expose-Headers": "X-Feed-Generation",
        ...(file.generation ? { "X-Feed-Generation": file.generation } : {}),
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: `${errorLabel} momenteel niet beschikbaar.`,
      },
      { status: 503 }
    );
  }
}

export function corsOptions() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
