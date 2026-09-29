/**
 * Extracts product details from a page's metadata.
 *
 * OpenGraph tags are the first choice because they exist to describe products
 * to link previews. JSON-LD is the fallback for price, and is often the only
 * reliable source on Shopify-style storefronts.
 *
 * Everything returned here is treated as a *suggestion*: the UI lets the user
 * correct any field before rendering. Scraping is best-effort by nature.
 */

import { load, type CheerioAPI } from "cheerio";
import type { ProductField, ProductInfo } from "./types";

const MAX_TEXT_LENGTH = 300;

/**
 * Strips control characters, zero-width/format characters, and the Unicode
 * replacement character. Anything left in here gets painted into an exported
 * image, where a stray control or tofu glyph is visible and unfixable.
 */
function cleanText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff\ufffd]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function metaContent($: CheerioAPI, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = $(selector).first().attr("content");
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function resolveUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const resolved = new URL(value, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function findProductNode(
  node: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  const rawType = record["@type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  const isProduct = types.some(
    (type) => typeof type === "string" && type.toLowerCase() === "product",
  );
  if (isProduct) return record;

  for (const value of Object.values(record)) {
    const found = findProductNode(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function readJsonLdProduct($: CheerioAPI): Record<string, unknown> | null {
  const scripts = $('script[type="application/ld+json"]');

  for (const element of scripts.toArray()) {
    const raw = $(element).text();
    if (!raw || raw.length > 200_000) continue;

    try {
      const parsed: unknown = JSON.parse(raw);
      const product = findProductNode(parsed);
      if (product) return product;
    } catch {
      // Malformed JSON-LD is common; skip it rather than fail the request.
    }
  }

  return null;
}

function readJsonLdOffers(product: Record<string, unknown>): {
  price: string | null;
  currency: string | null;
} {
  const rawOffers = product.offers;
  const offers = Array.isArray(rawOffers) ? rawOffers : [rawOffers];

  for (const entry of offers) {
    if (!entry || typeof entry !== "object") continue;
    const offer = entry as Record<string, unknown>;

    const price = [offer.price, offer.lowPrice, offer.highPrice].find(
      (value) => typeof value === "string" || typeof value === "number",
    );

    if (price !== undefined && price !== null) {
      return {
        price: cleanText(String(price)),
        currency:
          typeof offer.priceCurrency === "string"
            ? cleanText(offer.priceCurrency).toUpperCase()
            : null,
      };
    }
  }

  return { price: null, currency: null };
}

function readJsonLdText(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value) || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = readJsonLdText(entry);
      if (text) return text;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return readJsonLdText(record.name ?? record.url);
  }
  return null;
}

export type ExtractArgs = {
  html: string;
  resolvedUrl: string;
  sourceUrl: string;
};

export function extractProductInfo({
  html,
  resolvedUrl,
  sourceUrl,
}: ExtractArgs): ProductInfo {
  const $ = load(html);

  const jsonLd = readJsonLdProduct($);
  const jsonLdOffers = jsonLd ? readJsonLdOffers(jsonLd) : null;

  const title =
    metaContent($, [
      'meta[property="og:title"]',
      'meta[name="og:title"]',
      'meta[name="twitter:title"]',
      'meta[property="twitter:title"]',
    ]) ??
    (jsonLd ? readJsonLdText(jsonLd.name) : null) ??
    cleanText($("title").first().text()) ??
    "";

  const description =
    metaContent($, [
      'meta[property="og:description"]',
      'meta[name="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ]) ??
    (jsonLd ? readJsonLdText(jsonLd.description) : null) ??
    "";

  const rawImage =
    metaContent($, [
      'meta[property="og:image:secure_url"]',
      'meta[property="og:image:url"]',
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]',
    ]) ??
    (jsonLd ? readJsonLdText(jsonLd.image) : null) ??
    $('link[rel="image_src"]').first().attr("href") ??
    null;

  const imageUrl = resolveUrl(rawImage, resolvedUrl);

  const price =
    metaContent($, [
      'meta[property="product:price:amount"]',
      'meta[name="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[itemprop="price"]',
    ]) ?? jsonLdOffers?.price ?? null;

  const currency = (
    metaContent($, [
      'meta[property="product:price:currency"]',
      'meta[property="og:price:currency"]',
      'meta[itemprop="priceCurrency"]',
    ]) ??
    jsonLdOffers?.currency ??
    null
  )?.toUpperCase() ?? null;

  const siteName = metaContent($, [
    'meta[property="og:site_name"]',
    'meta[name="application-name"]',
  ]);

  const missing: ProductField[] = [];
  if (!title) missing.push("title");
  if (!imageUrl) missing.push("image");
  if (!price) missing.push("price");

  return {
    sourceUrl,
    resolvedUrl,
    title: title || "",
    description,
    imageUrl,
    price,
    currency,
    siteName,
    missing,
  };
}
