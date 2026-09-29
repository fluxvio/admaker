"use client";

import type { Analytics } from "firebase/analytics";

import type { ConsentDecision } from "./consent";

/**
 * Firebase Analytics for the browser, loaded lazily and completely inert until
 * the project is configured.
 *
 * Three rules this module follows:
 *
 * 1. Analytics must never break the product. Every path is wrapped, the SDK is
 *    dynamically imported, and failures degrade to a no-op.
 * 2. Nothing is sent unless configured. With no NEXT_PUBLIC_FIREBASE_* vars the
 *    module logs intended events to the console instead, so local development
 *    still shows what would have been reported.
 * 3. No personally identifying values. Product URLs and titles are never sent -
 *    only the source host and aggregate counters. A product URL can carry query
 *    parameters (session tokens, emails) and a title is user content.
 *
 * Config note: Next.js inlines NEXT_PUBLIC_* at BUILD time, so these values must
 * be read as literal `process.env.NEXT_PUBLIC_X` expressions. A computed
 * `process.env[key]` lookup is not replaced in the browser bundle and yields
 * undefined.
 */

/** GA4 event names must be snake_case, <= 40 chars, starting with a letter. */
export type AnalyticsEvent =
  | "product_link_submitted"
  | "product_scraped"
  | "product_image_uploaded"
  | "selection_changed"
  | "export_started"
  | "export_completed"
  | "export_failed";

type AnalyticsParamValue = string | number;

export type AnalyticsParams = Record<string, AnalyticsParamValue>;

function readConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };
}

export function isAnalyticsConfigured(): boolean {
  const config = readConfig();
  return Boolean(
    config.apiKey && config.projectId && config.appId && config.measurementId,
  );
}

/**
 * Collection stays blocked until a consent decision exists.
 *
 * Required by DEFAULT, because GA4 sets cookies: the safe default is to collect
 * nothing until the visitor decides. Set
 * NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT=false to skip the gate entirely, which
 * is only appropriate for internal tooling with no public visitors.
 */
export const analyticsConsentRequired =
  process.env.NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT !== "false";

type ConsentState = "unknown" | "granted" | "denied";

let consent: ConsentState = "unknown";
let analyticsPromise: Promise<Analytics | null> | null = null;
let hasWarned = false;

function warnOnce(error: unknown) {
  if (hasWarned) return;
  hasWarned = true;
  console.warn("[analytics] disabled after an error:", error);
}

function mayCollect(): boolean {
  if (!analyticsConsentRequired) return true;
  return consent === "granted";
}

async function createAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined") return null;
  if (!isAnalyticsConfigured() || !mayCollect()) return null;

  try {
    const [{ initializeApp, getApp, getApps }, { getAnalytics, isSupported }] =
      await Promise.all([import("firebase/app"), import("firebase/analytics")]);

    // isSupported() returns false in environments without cookies/indexedDB
    // (private modes, some embedded webviews). Skip rather than throw.
    if (!(await isSupported())) return null;

    const app = getApps().length > 0 ? getApp() : initializeApp(readConfig());
    return getAnalytics(app);
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

/**
 * Initialises Analytics once and caches the result.
 *
 * The Firebase SDK sends an initial `page_view` as part of automatic collection,
 * so this module deliberately does not log one itself - doing so would double
 * count every visit, which matters because that number is what the daily and
 * monthly visitor reports are built from.
 */
export function loadAnalytics(): Promise<Analytics | null> {
  analyticsPromise ??= createAnalytics();
  return analyticsPromise;
}

export function setAnalyticsConsent(value: ConsentDecision): void {
  consent = value;

  if (value === "denied") {
    void revokeAnalytics();
    return;
  }

  // A previous attempt may have been blocked by the consent gate, so drop the
  // cached decision and try again now that consent exists.
  analyticsPromise = null;
  void loadAnalytics();
}

/**
 * Stops collection.
 *
 * Called when consent is declined or later withdrawn, including after
 * collection has already begun - otherwise withdrawing consent would be
 * cosmetic, since the SDK keeps sending in the background once initialised.
 */
export async function revokeAnalytics(): Promise<void> {
  consent = "denied";

  const pending = analyticsPromise;
  analyticsPromise = null;

  if (!pending) return;

  try {
    const analytics = await pending;
    if (!analytics) return;

    const { setAnalyticsCollectionEnabled } = await import("firebase/analytics");
    setAnalyticsCollectionEnabled(analytics, false);
  } catch (error) {
    warnOnce(error);
  }
}

/** Fire-and-forget. Never throws, never blocks the caller. */
export async function trackEvent(
  event: AnalyticsEvent,
  params: AnalyticsParams = {},
): Promise<void> {
  const payload: AnalyticsParams = {
    ...params,
    // Surfaces events in GA4 DebugView while developing.
    ...(process.env.NODE_ENV !== "production" ? { debug_mode: 1 } : {}),
  };

  if (!isAnalyticsConfigured() || !mayCollect()) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[analytics]", event, payload);
    }
    return;
  }

  try {
    const analytics = await loadAnalytics();
    if (!analytics) return;

    const { logEvent } = await import("firebase/analytics");
    logEvent(analytics, event, payload);
  } catch (error) {
    warnOnce(error);
  }
}

/**
 * Host only, never the full URL. Shared by the scrape events so no query
 * parameters or path segments leave the browser.
 */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "invalid";
  }
}
