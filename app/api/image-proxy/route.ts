import { NextResponse } from "next/server";
import { readCappedBuffer, safeFetch, UnsafeUrlError } from "@/lib/url-guard";

/**
 * Serves remote product images from our own origin.
 *
 * Why this exists: drawing a cross-origin image into a canvas (which is what
 * html-to-image does during export) taints the canvas and throws a security
 * error. Re-serving the bytes from the same origin sidesteps that, and the
 * upstream fetch goes through the same SSRF guard as the scraper.
 *
 * SVG is deliberately not proxied: serving author-controlled SVG from our
 * origin invites script execution on direct navigation.
 */
export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing url parameter." },
      { status: 400 },
    );
  }

  try {
    const { response } = await safeFetch(rawUrl, { accept: "image/*" });

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: `Image request failed (${response.status}).` },
        { status: 502 },
      );
    }

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return NextResponse.json(
        { ok: false, error: "That URL isn't a supported image format." },
        { status: 415 },
      );
    }

    const bytes = await readCappedBuffer(response, MAX_IMAGE_BYTES);

    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
        // Same-origin reads for canvas export; the image itself is public.
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }

    console.error("[image-proxy] unexpected failure", error);
    return NextResponse.json(
      { ok: false, error: "Could not load that image." },
      { status: 500 },
    );
  }
}
