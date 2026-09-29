/**
 * SSRF protection for the scraping and image-proxy routes.
 *
 * A route that fetches a user-supplied URL on the server is a request forgery
 * primitive: it can be pointed at cloud metadata endpoints, internal admin
 * panels, or localhost services. Two things prevent that here:
 *
 *  1. Validate the URL, then resolve the hostname and reject private addresses.
 *     Resolving matters - a public hostname can map to 127.0.0.1.
 *  2. Follow redirects manually and re-validate every hop, because an
 *     attacker-controlled host can redirect to an internal target.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
/** Allowed ports. Empty string is the implicit 80/443 default. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

export const SCRAPER_USER_AGENT =
  "AdMakerBot/0.1 (+https://example.com/bot; product link preview)";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inIpv4Range(value: number, cidrBase: string, prefix: number): boolean {
  const base = ipv4ToInt(cidrBase);
  if (base === null) return false;
  const mask = prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true; // unparseable - treat as unsafe
  return PRIVATE_IPV4_RANGES.some(([base, prefix]) =>
    inIpv4Range(value, base, prefix),
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalised = address.toLowerCase().split("%")[0];

  if (normalised === "::" || normalised === "::1") return true;

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms.
  const mapped = normalised.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  const firstGroup = normalised.split(":").find((group) => group.length > 0);
  if (!firstGroup) return true;

  const leading = Number.parseInt(firstGroup.slice(0, 2).padEnd(2, "0"), 16);
  if (!Number.isFinite(leading)) return true;

  // fc00::/7 unique-local, fe80::/10 link-local.
  if ((leading & 0xfe00) === 0xfc00) return true;
  if ((leading & 0xffc0) === 0xfe80) return true;

  return false;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost") return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host.endsWith(".internal")) return true;
  if (host.endsWith(".home.arpa")) return true;
  return false;
}

/** Parses and validates the URL shape. Does not perform DNS resolution. */
export function parseTargetUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new UnsafeUrlError("Enter a product URL first.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError(
      "That doesn't look like a valid URL. Include the https:// part.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https links are supported.");
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError("Only standard web ports (80 and 443) are allowed.");
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError("Links with embedded credentials aren't allowed.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host)) {
    throw new UnsafeUrlError("That host isn't reachable from this service.");
  }

  return url;
}

/**
 * Rejects hostnames that resolve to private addresses. Called for every hop so
 * a redirect cannot smuggle in an internal target.
 */
async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new UnsafeUrlError("That host isn't reachable from this service.");
    }
    return;
  }

  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(
      "We couldn't resolve that hostname. Check the link and try again.",
    );
  }

  if (records.length === 0) {
    throw new UnsafeUrlError("We couldn't resolve that hostname.");
  }

  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new UnsafeUrlError("That host isn't reachable from this service.");
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export type SafeFetchOptions = {
  accept?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: BodyInit;
};

export type SafeFetchResult = {
  response: Response;
  finalUrl: string;
};

/**
 * Fetches a user-supplied URL with per-hop validation, a request timeout, and
 * manual redirect handling.
 */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  let current = parseTargetUrl(input);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(current, {
        method: options.method ?? "GET",
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": SCRAPER_USER_AGENT,
          accept: options.accept ?? "*/*",
          "accept-language": "en-US,en;q=0.9",
          ...options.headers,
        },
      });
    } catch {
      throw new UnsafeUrlError(
        "We couldn't reach that link. It may be offline or blocking automated requests.",
      );
    } finally {
      clearTimeout(timer);
    }

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      // Release the redirect body before following it.
      await response.body?.cancel().catch(() => {});
      if (!location) {
        throw new UnsafeUrlError("That link sent an invalid redirect.");
      }
      current = parseTargetUrl(new URL(location, current).toString());
      continue;
    }

    return { response, finalUrl: current.toString() };
  }

  throw new UnsafeUrlError("That link redirected too many times.");
}

/**
 * Reads a response body, enforcing a byte ceiling.
 *
 * Returns an ArrayBuffer rather than a typed-array view: ArrayBuffer is
 * unambiguously valid as a Response body and as TextDecoder input, whereas the
 * generic Uint8Array types are not assignable to BodyInit.
 *
 * With `allowTruncate`, exceeding the ceiling keeps the bytes read so far
 * instead of failing. That matters for HTML: product pages routinely exceed
 * several megabytes, but the metadata we want sits in the head, so a prefix is
 * enough - whereas a truncated image would be corrupt.
 */
async function readStream(
  response: Response,
  maxBytes: number,
  allowTruncate: boolean,
): Promise<ArrayBuffer> {
  if (!allowTruncate) {
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new UnsafeUrlError("That file is too large to process.");
    }
  }

  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    const remaining = maxBytes - total;

    if (remaining <= 0) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }

    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      total += remaining;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }

    chunks.push(value);
    total += value.byteLength;
  }

  if (truncated && !allowTruncate) {
    throw new UnsafeUrlError("That file is too large to process.");
  }

  const buffer = new ArrayBuffer(total);
  const view = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** Reads a body and fails if it exceeds the ceiling. For binary assets. */
export function readCappedBuffer(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  return readStream(response, maxBytes, false);
}

/** Reads up to the ceiling and keeps the prefix. For HTML documents. */
export function readTruncatedBuffer(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  return readStream(response, maxBytes, true);
}
