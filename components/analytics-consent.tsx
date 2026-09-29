"use client";

import { Button } from "@heroui/react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  isAnalyticsConfigured,
  revokeAnalytics,
  setAnalyticsConsent,
} from "@/lib/analytics";
import {
  readAnalyticsConsent,
  subscribeNever,
  subscribeToAnalyticsConsent,
  writeAnalyticsConsent,
  type ConsentDecision,
} from "@/lib/consent";

/**
 * Consent banner and preference control.
 *
 * Collection is blocked until a decision exists (see `analyticsConsentRequired`
 * in lib/analytics.ts), so declining is as effective as never having loaded the
 * SDK. Accepting or declining is remembered per browser, and the stored choice
 * can be changed later via the "Cookie settings" control - withdrawing consent
 * has to be as easy as giving it.
 *
 * The stored preference is read through useSyncExternalStore rather than an
 * effect: it keeps the server and first client render identical (no hydration
 * mismatch) and avoids setting state inside an effect body.
 */
export function AnalyticsConsent() {
  // Rendering nothing until the client render avoids showing the banner for a
  // frame to visitors who have already decided.
  const isClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const decision = useSyncExternalStore(
    subscribeToAnalyticsConsent,
    readAnalyticsConsent,
    () => null,
  );

  const [isReopened, setIsReopened] = useState(false);

  // Apply whatever was stored before. No state is set here, so this cannot
  // trigger a cascading render.
  useEffect(() => {
    if (decision === "granted") setAnalyticsConsent("granted");
    if (decision === "denied") void revokeAnalytics();
  }, [decision]);

  const decide = useCallback((value: ConsentDecision) => {
    writeAnalyticsConsent(value);
    setAnalyticsConsent(value);
    if (value === "denied") void revokeAnalytics();
    setIsReopened(false);
  }, []);

  // Nothing is collected without configuration, so a banner would be noise.
  if (!isClient || !isAnalyticsConfigured()) return null;

  const isBannerVisible = decision === null || isReopened;

  if (!isBannerVisible) {
    return (
      <button
        type="button"
        className="fixed bottom-2 left-2 z-40 rounded px-2 py-1 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        onClick={() => setIsReopened(true)}
      >
        Cookie settings
      </button>
    );
  }

  return (
    <div
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4"
      role="region"
    >
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-black/10 bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center dark:border-white/15 dark:bg-neutral-900/95">
        <p className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">
          <span className="font-medium">May we measure usage?</span> We use
          Firebase Analytics to see which parts of the tool get used and where it
          breaks. Product links and titles are never sent, only counts.
        </p>

        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="primary" onPress={() => decide("granted")}>
            Accept analytics
          </Button>
          <Button size="sm" variant="outline" onPress={() => decide("denied")}>
            Decline
          </Button>
        </div>
      </div>
    </div>
  );
}
