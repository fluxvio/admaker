/**
 * Analytics consent preference.
 *
 * Stored in localStorage rather than a cookie on purpose: it is a preference for
 * this browser that the server never needs, so recording the cookie decision
 * does not itself require setting a cookie.
 */

export const ANALYTICS_CONSENT_KEY = "admaker:analytics-consent";

/** Dispatched on this window whenever the stored preference changes. */
const CONSENT_CHANGE_EVENT = "admaker:analytics-consent-change";

export type ConsentDecision = "granted" | "denied";

export function readAnalyticsConsent(): ConsentDecision | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    // Storage can throw in private modes and restricted webviews.
    return null;
  }
}

export function writeAnalyticsConsent(decision: ConsentDecision): void {
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, decision);
  } catch {
    // The preference will not survive a reload, but the choice still applies
    // for this session because the in-memory consent is set separately.
  }

  // Notify this tab, and other tabs via their `storage` listeners.
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}

/** Subscription used by useSyncExternalStore. */
export function subscribeToAnalyticsConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);

  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Subscription that never fires; used to detect the first client render. */
export function subscribeNever(): () => void {
  return () => {};
}
