/**
 * Three independent axes make up an export:
 *
 *   layout - how the ad is composed (where the image and copy sit)
 *   theme  - how the ad looks (palette + typography)
 *   size   - the canvas dimensions
 *
 * Exporting the cross product of the selected options is what turns one product
 * URL into a batch. Keeping layout and theme separate means one brand look can
 * be applied across every layout, instead of being locked to whichever palette
 * happened to ship with a layout.
 *
 * Everything here is plain data so an ad can be rendered with inline styles.
 * Inline styles matter because exports rasterise the DOM: any value that depends
 * on a Tailwind class being generated at runtime would be a fidelity risk.
 */

export type AdSizeId = "square" | "story" | "landscape";

export type AdSize = {
  id: AdSizeId;
  label: string;
  /** Human label for the aspect ratio, shown in the UI. */
  ratioLabel: string;
  width: number;
  height: number;
};

export const AD_SIZES: AdSize[] = [
  { id: "square", label: "Square", ratioLabel: "1:1", width: 1080, height: 1080 },
  { id: "story", label: "Story", ratioLabel: "9:16", width: 1080, height: 1920 },
  { id: "landscape", label: "Landscape", ratioLabel: "1.91:1", width: 1200, height: 628 },
];

export function getSize(id: AdSizeId): AdSize {
  const size = AD_SIZES.find((candidate) => candidate.id === id);
  if (!size) throw new Error(`Unknown ad size: ${id}`);
  return size;
}

export type AdLayoutId = "spotlight" | "split" | "banner";

export type AdLayout = {
  id: AdLayoutId;
  name: string;
  description: string;
};

export const AD_LAYOUTS: AdLayout[] = [
  {
    id: "spotlight",
    name: "Spotlight",
    description: "Product centred above the copy. Suits bold product shots.",
  },
  {
    id: "split",
    name: "Split",
    description: "Product on one side, copy on the other.",
  },
  {
    id: "banner",
    name: "Banner",
    description: "Copy-led strip. Lends itself to landscape placements.",
  },
];

export type AdPalette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  /** Foreground colour that stays legible on top of `accent`. */
  onAccent: string;
};

export type AdFontId = "sans" | "mono";

export type AdTheme = {
  id: string;
  name: string;
  description: string;
  palette: AdPalette;
  font: AdFontId;
};

/**
 * A theme is the brand look: palette plus typography. Layouts are deliberately
 * theme-agnostic so one brand look can be applied across every layout.
 */
export const AD_THEMES: AdTheme[] = [
  {
    id: "midnight",
    name: "Midnight",
    description: "Dark navy with a cool accent. High impact.",
    font: "sans",
    palette: {
      background: "#0f172a",
      surface: "#1e293b",
      text: "#f8fafc",
      muted: "#94a3b8",
      accent: "#38bdf8",
      onAccent: "#0b1220",
    },
  },
  {
    id: "porcelain",
    name: "Porcelain",
    description: "Clean white and black. Understated retail look.",
    font: "sans",
    palette: {
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
      accent: "#0f172a",
      onAccent: "#ffffff",
    },
  },
  {
    id: "lavender",
    name: "Lavender",
    description: "Soft purple. Beauty, wellness, lifestyle.",
    font: "sans",
    palette: {
      background: "#faf5ff",
      surface: "#ffffff",
      text: "#3b0764",
      muted: "#7e22ce",
      accent: "#a855f7",
      onAccent: "#ffffff",
    },
  },
  {
    id: "ember",
    name: "Ember",
    description: "Warm orange. Promotions and seasonal sales.",
    font: "sans",
    palette: {
      background: "#fff7ed",
      surface: "#ffffff",
      text: "#7c2d12",
      muted: "#c2410c",
      accent: "#f97316",
      onAccent: "#ffffff",
    },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Deep green. Outdoors, sustainability, food.",
    font: "sans",
    palette: {
      background: "#052e16",
      surface: "#14532d",
      text: "#ecfdf5",
      muted: "#86efac",
      accent: "#a3e635",
      onAccent: "#052e16",
    },
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Monospace on near-black. Tech and developer tools.",
    font: "mono",
    palette: {
      background: "#0a0f0d",
      surface: "#12201b",
      text: "#d1fae5",
      muted: "#6ee7b7",
      accent: "#34d399",
      onAccent: "#04140d",
    },
  },
];

export const DEFAULT_LAYOUT_IDS: string[] = AD_LAYOUTS.map(
  (layout) => layout.id,
);

/**
 * One theme by default: a store owner usually has a single brand look, so the
 * default export is a consistent branded set rather than a mix of styles.
 */
export const DEFAULT_THEME_IDS: string[] = [AD_THEMES[0].id];

export const DEFAULT_SIZE_IDS: AdSizeId[] = AD_SIZES.map((size) => size.id);

export type RenderTarget = {
  layout: AdLayout;
  theme: AdTheme;
  size: AdSize;
};

export function buildRenderTargets(
  layoutIds: string[],
  themeIds: string[],
  sizeIds: AdSizeId[],
): RenderTarget[] {
  const layouts = AD_LAYOUTS.filter((layout) => layoutIds.includes(layout.id));
  const themes = AD_THEMES.filter((theme) => themeIds.includes(theme.id));
  const sizes = AD_SIZES.filter((size) => sizeIds.includes(size.id));

  return layouts.flatMap((layout) =>
    themes.flatMap((theme) => sizes.map((size) => ({ layout, theme, size }))),
  );
}

export function renderTargetFilename(
  target: RenderTarget,
  productTitle: string,
): string {
  const slug = productTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  const prefix = slug || "ad";
  return `${prefix}-${target.layout.id}-${target.theme.id}-${target.size.id}.png`;
}

/**
 * Character count is a rough proxy for rendered width, not a substitute for
 * measuring. It gives a sane starting point; the layout still clamps lines and
 * hides overflow so a bad estimate degrades instead of breaking the frame.
 */
export function computeTitleFontSize(title: string, size: AdSize): number {
  const length = [...title.trim()].length || 1;

  const base =
    size.id === "landscape" ? size.height * 0.13 : size.width * 0.078;

  const scale =
    length <= 22
      ? 1
      : length <= 36
        ? 0.84
        : length <= 55
          ? 0.7
          : length <= 80
            ? 0.56
            : 0.46;

  return Math.round(base * scale);
}

export function formatPrice(
  price: string | null,
  currency: string | null,
): string | null {
  if (!price) return null;

  const numeric = Number.parseFloat(price.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return price;

  if (currency) {
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(numeric);
    } catch {
      // Unknown/invalid currency code - fall through to a plain formatted number.
    }
  }

  return new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}
