/**
 * Client instrumentation. Next.js runs this before the application's frontend
 * code, which is the right place to start analytics.
 *
 * Location verified against node_modules/next/dist/build/create-compiler-aliases.js:
 * Next resolves `instrumentation-client.{ts,tsx,js,jsx}` from either the project
 * root or `src/`. This project has no `src/`, so it lives at the root.
 *
 * loadAnalytics() is deliberately fire-and-forget: it resolves to null when the
 * Firebase environment variables are absent, so this file is a no-op until the
 * project is configured.
 */
import { loadAnalytics, setAnalyticsConsent } from "./lib/analytics";
import { readAnalyticsConsent } from "./lib/consent";

// Apply a previously stored decision before initialising, so a returning visitor
// who already accepted is measured from the first page load instead of waiting
// for React to mount. With no stored decision, collection stays blocked until the
// consent banner is answered.
const storedDecision = readAnalyticsConsent();
if (storedDecision) setAnalyticsConsent(storedDecision);

void loadAnalytics();
