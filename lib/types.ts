/** Fields extracted from a product page, plus which ones we failed to find. */
export type ProductField = "title" | "image" | "price";

export type ProductInfo = {
  /** The URL the user submitted. */
  sourceUrl: string;
  /** The URL we actually ended up reading, after redirects. */
  resolvedUrl: string;
  title: string;
  description: string;
  imageUrl: string | null;
  /** Display-ready price string, e.g. "49.00". */
  price: string | null;
  /** ISO 4217 code when the page provided one. */
  currency: string | null;
  siteName: string | null;
  /**
   * Fields we could not extract confidently. The UI surfaces these so the user
   * can type a value instead of shipping an ad with a blank price.
   */
  missing: ProductField[];
};

export type ScrapeResponse = {
  ok: true;
  product: ProductInfo;
};

export type ScrapeErrorResponse = {
  ok: false;
  error: string;
};

export type ScrapeResult = ScrapeResponse | ScrapeErrorResponse;
