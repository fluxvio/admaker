import { NextResponse } from "next/server";
import { extractProductInfo } from "@/lib/product-metadata";
import {
  readTruncatedBuffer,
  safeFetch,
  UnsafeUrlError,
} from "@/lib/url-guard";
import type { ProductInfo } from "@/lib/types";

/**
 * Reads a product page and returns its metadata.
 *
 * Node runtime is required: the URL guard uses node:dns for the private-address
 * check, and cheerio parses HTML in-process.
 */
export const runtime = "nodejs";

/**
 * Budget for the HTML prefix we read. Storefronts routinely ship multi-megabyte
 * documents, but OpenGraph and JSON-LD live in the head, so reading a prefix and
 * discarding the rest is both sufficient and much cheaper than the whole page.
 */
const MAX_HTML_BYTES = 1_500_000;

const HTML_ACCEPT =
  "text/html,application/xhtml+xml;q=0.9,application/xml;q=0.8,*/*;q=0.7";

function decodeBody(bytes: ArrayBuffer, contentType: string | null): string {
  const charset =
    contentType?.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase() ?? "utf-8";

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // Unknown charset label - UTF-8 is the practical default.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function scrape(rawUrl: string): Promise<ProductInfo> {
  const { response, finalUrl } = await safeFetch(rawUrl, {
    accept: HTML_ACCEPT,
  });

  if (!response.ok) {
    throw new UnsafeUrlError(
      response.status === 403 || response.status === 429
        ? "That store blocked the request. Try uploading the product image manually."
        : `That page returned an error (${response.status}).`,
    );
  }

  const contentType = response.headers.get("content-type");
  if (contentType && !/text\/html|application\/xhtml|application\/xml/i.test(contentType)) {
    throw new UnsafeUrlError(
      "That link isn't a web page. Paste a product page URL.",
    );
  }

  const bytes = await readTruncatedBuffer(response, MAX_HTML_BYTES);
  const html = decodeBody(bytes, contentType);

  return extractProductInfo({ html, resolvedUrl: finalUrl, sourceUrl: rawUrl });
}

async function handle(rawUrl: string | null): Promise<NextResponse> {
  if (!rawUrl) {
    return NextResponse.json(
      { ok: false, error: "Enter a product URL first." },
      { status: 400 },
    );
  }

  try {
    const product = await scrape(rawUrl);
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }

    console.error("[scrape] unexpected failure", error);
    return NextResponse.json(
      { ok: false, error: "Something went wrong reading that page." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let rawUrl: string | null = null;

  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "url" in body) {
      const value = (body as { url: unknown }).url;
      if (typeof value === "string") rawUrl = value;
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Expected a JSON body with a url field." },
      { status: 400 },
    );
  }

  return handle(rawUrl);
}

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url");
  return handle(rawUrl);
}
