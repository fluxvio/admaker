This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Analytics

Visitor behaviour is collected with Firebase Analytics (GA4). Collection is
completely inert until the Firebase environment variables are present, so the
app runs fine without a Firebase project.

### Setup

1. Create a project at <https://console.firebase.google.com>, add a **Web app**,
   and enable **Analytics** for it (this provisions the GA4 property).
2. Copy `.env.example` to `.env.local` and fill in the values from
   *Project settings → Your apps → Web app → SDK setup*.
3. Rebuild. `NEXT_PUBLIC_*` values are inlined at build time, so changing them
   needs a restart *and* a fresh build — not just an edit.

Without `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` the SDK is never initialised, and
intended events are logged to the browser console instead:

```
[analytics] export_completed {ad_count: 12, duration_ms: 656}
```

That makes it possible to develop event wiring locally without sending anything.

### Where the numbers come from

Daily and monthly visitor counts are a **built-in report**, not code. Once
collection is running:

- **Firebase console → Analytics → Dashboard** — users and sessions per day.
- **GA4 → Reports → Reports snapshot / Engagement** — daily, weekly and monthly
  active users, plus retention.
- **GA4 → Reports → Realtime** — verify your own visit shows up immediately.
- **GA4 → Admin → DebugView** — see individual events during development.

### Events

| Event | Purpose |
| --- | --- |
| `page_view` | Sent automatically by the SDK on init. Do **not** log it manually — that would double count every visit. |
| `product_link_submitted` | A URL was submitted, with `source_host` only. |
| `product_scraped` | `success` and `missing_fields`, so extraction quality is measurable. |
| `product_image_uploaded` | Distinguishes the blocked-hotlink fallback from a deliberate swap. |
| `selection_changed` | Layout / theme / size toggles (`axis`, `enabled`). |
| `export_started` / `export_completed` | Ad counts and render duration. |
| `export_failed` | Render failures, so they are not invisible. |

### Consent

GA4 sets cookies, so **collection is blocked until the visitor answers the
banner** mounted in `app/layout.tsx`. This is the default; there is nothing to
configure.

- Accepting or declining is stored per browser in `localStorage` and re-applied
  by `instrumentation-client.ts` before the SDK initialises, so a returning
  visitor is measured from their first page load.
- Declining is as effective as never loading the SDK, and changing the stored
  choice later (via "Cookie settings") disables collection through
  `setAnalyticsCollectionEnabled` — withdrawing consent is not cosmetic.
- Set `NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT=false` to bypass the gate entirely.
  Only appropriate for internal tooling with no public visitors.

### Privacy

- No product URLs or titles are ever sent — a product URL can contain session
  tokens or emails, and a title is user content. Only the hostname is reported.
- Analytics is off until the visitor chooses; see [Consent](#consent).

## Icons

`app/icon.svg` is the single source of truth for the app mark: a composed ad —
framed canvas, product image, headline bar, caption bar. It is authored by hand
and uses the Midnight theme colours.

Two raster variants exist alongside it, because neither can be an SVG:

| File | Notes |
| --- | --- |
| `app/favicon.ico` | 16/32/48/64 px entries with embedded PNG data, transparent. Serves the bare `/favicon.ico` request that browsers make before parsing the page. |
| `app/apple-icon.png` | 180×180, for iOS home screens (Apple ignores SVG here). |

**These rasters do not regenerate themselves.** Both were produced by rendering
`icon.svg` at 1× device scale and assembling the ICO container, so editing
`icon.svg` alone will leave `favicon.ico` and `apple-icon.png` showing the old
mark — regenerate them too.

Note the 1× detail: rendering at the default 2× device scale produces files at
double the intended pixel size, which yields a malformed ICO.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
