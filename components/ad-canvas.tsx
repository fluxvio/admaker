import type { CSSProperties } from "react";
import {
  computeTitleFontSize,
  type AdFontId,
  type AdLayout,
  type AdSize,
  type AdTheme,
} from "@/lib/templates";

/**
 * Renders one ad at its true export dimensions.
 *
 * Deliberately styled with inline styles rather than Tailwind classes: this
 * node is rasterised by html-to-image, and every value it paints needs to be
 * resolvable without depending on a utility class being generated. A plain
 * <img> is used for the same reason - next/image adds srcset and an optimizer
 * URL that complicate canvas capture.
 */

export type AdContent = {
  title: string;
  /** Already formatted for display, e.g. "$49.00". */
  price: string | null;
  description: string;
  imageSrc: string | null;
  siteName: string | null;
  onImageError?: () => void;
};

export type AdCanvasProps = {
  layout: AdLayout;
  theme: AdTheme;
  size: AdSize;
  content: AdContent;
};

const FONT_STACKS: Record<AdFontId, string> = {
  sans: 'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
};

function lineClamp(lines: number): CSSProperties {
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}

export function AdCanvas({ layout, theme, size, content }: AdCanvasProps) {
  const { width, height } = size;
  const { palette } = theme;

  const unit = Math.min(width, height);
  const pad = Math.round(unit * 0.075);
  const isWide = width / height >= 1.2;

  const titleText = content.title.trim() || "Your product name";
  const titleSize = computeTitleFontSize(titleText, size);
  const descSize = Math.round(unit * 0.028);
  const eyebrowSize = Math.round(unit * 0.024);
  const pillSize = Math.round(unit * 0.042);

  const frame: CSSProperties = {
    width,
    height,
    boxSizing: "border-box",
    display: "flex",
    overflow: "hidden",
    position: "relative",
    backgroundColor: palette.background,
    color: palette.text,
    fontFamily: FONT_STACKS[theme.font],
  };

  const eyebrow: CSSProperties = {
    fontSize: eyebrowSize,
    fontWeight: 600,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: palette.muted,
  };

  const description: CSSProperties = {
    fontSize: descSize,
    lineHeight: 1.4,
    color: palette.muted,
    ...lineClamp(2),
  };

  const pricePill: CSSProperties = {
    alignSelf: "flex-start",
    backgroundColor: palette.accent,
    color: palette.onAccent,
    borderRadius: 999,
    padding: `${Math.round(unit * 0.018)}px ${Math.round(unit * 0.042)}px`,
    fontSize: pillSize,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
  };

  const imageBox: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 0,
    minWidth: 0,
  };

  const image = content.imageSrc ? (
    // eslint-disable-next-line @next/next/no-img-element -- canvas export needs a plain, resolved <img>
    <img
      src={content.imageSrc}
      alt=""
      onError={content.onImageError}
      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
    />
  ) : (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `2px dashed ${palette.muted}`,
        borderRadius: Math.round(unit * 0.04),
        color: palette.muted,
        fontSize: descSize,
        textAlign: "center",
      }}
    >
      No product image
    </div>
  );

  if (layout.id === "spotlight") {
    return (
      <div
        style={{
          ...frame,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          textAlign: "center",
          gap: Math.round(pad * 0.6),
          padding: pad,
        }}
      >
        {content.siteName ? <div style={eyebrow}>{content.siteName}</div> : null}

        <div style={{ ...imageBox, flex: "1 1 auto", width: "100%" }}>
          {image}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: Math.round(pad * 0.4),
            width: "100%",
          }}
        >
          <div
            style={{
              fontSize: titleSize,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              ...lineClamp(3),
            }}
          >
            {titleText}
          </div>

          {content.description ? (
            <div style={description}>{content.description}</div>
          ) : null}

          {content.price ? (
            <div style={{ ...pricePill, alignSelf: "center" }}>
              {content.price}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (layout.id === "split") {
    const stacked = !isWide;

    return (
      <div
        style={{
          ...frame,
          flexDirection: stacked ? "column" : "row",
          gap: Math.round(pad * 0.7),
          padding: pad,
        }}
      >
        <div
          style={{
            ...imageBox,
            flex: stacked ? "1 1 55%" : "1 1 50%",
            backgroundColor: palette.surface,
            borderRadius: Math.round(unit * 0.05),
            padding: Math.round(pad * 0.5),
          }}
        >
          {image}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: Math.round(pad * 0.35),
            flex: stacked ? "0 0 auto" : "1 1 50%",
            minWidth: 0,
          }}
        >
          {content.siteName ? <div style={eyebrow}>{content.siteName}</div> : null}

          <div
            style={{
              fontSize: titleSize,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              ...lineClamp(3),
            }}
          >
            {titleText}
          </div>

          {content.description ? (
            <div style={description}>{content.description}</div>
          ) : null}

          {content.price ? <div style={pricePill}>{content.price}</div> : null}
        </div>
      </div>
    );
  }

  // banner
  return (
    <div
      style={{
        ...frame,
        flexDirection: isWide ? "row" : "column",
        alignItems: isWide ? "center" : "stretch",
        justifyContent: "space-between",
        gap: Math.round(pad * 0.6),
        padding: pad,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: Math.round(pad * 0.3),
          flex: "1 1 auto",
          minWidth: 0,
        }}
      >
        {content.siteName ? <div style={eyebrow}>{content.siteName}</div> : null}

        <div
          style={{
            fontSize: titleSize,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            ...lineClamp(3),
          }}
        >
          {titleText}
        </div>

        {content.description ? (
          <div style={description}>{content.description}</div>
        ) : null}

        {content.price ? <div style={pricePill}>{content.price}</div> : null}
      </div>

      <div
        style={{
          ...imageBox,
          flex: isWide ? "0 0 42%" : "1 1 auto",
          height: isWide ? "100%" : undefined,
          width: isWide ? undefined : "100%",
          backgroundColor: palette.surface,
          borderRadius: Math.round(unit * 0.05),
          padding: Math.round(pad * 0.4),
        }}
      >
        {image}
      </div>
    </div>
  );
}
