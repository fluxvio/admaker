"use client";

import {
  Button,
  Checkbox,
  Input,
  Label,
  Spinner,
} from "@heroui/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { sourceHost, trackEvent } from "@/lib/analytics";
import { AdCanvas, type AdContent } from "@/components/ad-canvas";
import {
  downloadBlob,
  nextPaint,
  nodeToPngBlob,
  toSlug,
  waitForNodeAssets,
  zipBlobs,
} from "@/lib/export-ads";
import {
  AD_LAYOUTS,
  AD_SIZES,
  AD_THEMES,
  buildRenderTargets,
  DEFAULT_LAYOUT_IDS,
  DEFAULT_SIZE_IDS,
  DEFAULT_THEME_IDS,
  formatPrice,
  renderTargetFilename,
  type AdSizeId,
  type AdTheme,
  type RenderTarget,
} from "@/lib/templates";
import type { ProductInfo, ScrapeResult } from "@/lib/types";

const PREVIEW_WIDTH = 230;

/**
 * Previews render every selected combination at full export resolution, so the
 * grid is capped to keep the DOM and memory cost bounded. Export is unaffected.
 */
const MAX_PREVIEWS = 18;

/** Above this an export starts to feel like a batch job, so we say so. */
const LARGE_BATCH = 24;

type ImageStatus = "idle" | "loading" | "ready" | "error";

/** Small preview of a theme's background and accent colour. */
function ThemeSwatch({ theme }: { theme: AdTheme }) {
  return (
    <span
      aria-hidden
      className="mt-1 size-6 shrink-0 rounded-full border border-black/10 dark:border-white/20"
      style={{
        backgroundColor: theme.palette.background,
        boxShadow: `inset 0 0 0 6px ${theme.palette.accent}`,
      }}
    />
  );
}

export function AdMaker() {
  const [url, setUrl] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [imageProbe, setImageProbe] = useState<{
    src: string | null;
    status: ImageStatus;
  }>({ src: null, status: "idle" });

  const [layoutIds, setLayoutIds] = useState<string[]>(DEFAULT_LAYOUT_IDS);
  const [themeIds, setThemeIds] = useState<string[]>(DEFAULT_THEME_IDS);
  const [sizeIds, setSizeIds] = useState<AdSizeId[]>(DEFAULT_SIZE_IDS);

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<RenderTarget | null>(null);

  const exportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * Product images are re-served through our own origin so the canvas isn't
   * tainted during export. A user upload becomes a data URL, which needs no
   * proxy at all.
   */
  const imageSrc = useMemo(() => {
    if (uploadedImage) return uploadedImage;
    if (!product?.imageUrl) return null;
    return `/api/image-proxy?url=${encodeURIComponent(product.imageUrl)}`;
  }, [uploadedImage, product?.imageUrl]);

  const formattedPrice = useMemo(
    () => formatPrice(price.trim() || null, product?.currency ?? null),
    [price, product?.currency],
  );

  const content = useMemo<AdContent>(
    () => ({
      title,
      price: formattedPrice,
      description,
      imageSrc,
      siteName: product?.siteName ?? null,
    }),
    [title, description, formattedPrice, product?.siteName, imageSrc],
  );

  const targets = useMemo(
    () => buildRenderTargets(layoutIds, themeIds, sizeIds),
    [layoutIds, themeIds, sizeIds],
  );

  /**
   * Derived, not stored: a probe result only describes the src it was measured
   * against, so a changed src reads as loading without a synchronous setState
   * inside the effect body.
   */
  const imageStatus: ImageStatus = !imageSrc
    ? "idle"
    : imageProbe.src === imageSrc
      ? imageProbe.status
      : "loading";

  // Probe the image before export so a blocked hotlink surfaces as a clear
  // prompt to upload, rather than a silently blank render.
  useEffect(() => {
    if (!imageSrc) return;

    let cancelled = false;
    const probeImage = new Image();

    probeImage.onload = () => {
      if (!cancelled) setImageProbe({ src: imageSrc, status: "ready" });
    };
    probeImage.onerror = () => {
      if (!cancelled) setImageProbe({ src: imageSrc, status: "error" });
    };
    probeImage.src = imageSrc;

    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  const handleScrape = useCallback(async () => {
    setIsScraping(true);
    setScrapeError(null);

    void trackEvent("product_link_submitted", { source_host: sourceHost(url) });

    let succeeded = false;
    let missingFields = 0;

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const payload = (await response.json()) as ScrapeResult;

      if (!payload.ok) {
        setScrapeError(payload.error);
        return;
      }

      setProduct(payload.product);
      setTitle(payload.product.title);
      setDescription(payload.product.description);
      setPrice(payload.product.price ?? "");
      setUploadedImage(null);

      succeeded = true;
      missingFields = payload.product.missing.length;
    } catch {
      setScrapeError(
        "We couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setIsScraping(false);

      // Reported once, in `finally`, so a failed attempt cannot be counted twice.
      void trackEvent("product_scraped", {
        success: succeeded ? 1 : 0,
        missing_fields: missingFields,
        source_host: sourceHost(url),
      });
    }
  }, [url]);

  const handleImageUpload = useCallback(
    (file: File | undefined) => {
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setUploadedImage(reader.result);
        }
      };
      reader.readAsDataURL(file);

      void trackEvent("product_image_uploaded", {
        // Distinguishes the "store blocked us" fallback from a deliberate swap.
        replacing_scraped_image: product?.imageUrl ? 1 : 0,
      });
    },
    [product?.imageUrl],
  );

  const toggleLayout = useCallback((id: string, selected: boolean) => {
    setLayoutIds((current) => {
      if (selected) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((entry) => entry !== id);
    });

    // Tracked outside the state updater: React may invoke an updater twice,
    // which would double count the event.
    void trackEvent("selection_changed", {
      axis: "layout",
      enabled: selected ? 1 : 0,
    });
  }, []);

  const toggleTheme = useCallback((id: string, selected: boolean) => {
    setThemeIds((current) => {
      if (selected) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((entry) => entry !== id);
    });

    void trackEvent("selection_changed", {
      axis: "theme",
      enabled: selected ? 1 : 0,
    });
  }, []);

  const toggleSize = useCallback((id: AdSizeId, selected: boolean) => {
    setSizeIds((current) => {
      if (selected) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((entry) => entry !== id);
    });

    void trackEvent("selection_changed", {
      axis: "size",
      enabled: selected ? 1 : 0,
    });
  }, []);

  /**
   * Mounts exactly one export node at a time.
   *
   * Rendering every layout/theme/size combination at full resolution at once is
   * what makes browser exports run out of memory, so the loop swaps a single
   * node in and out instead.
   */
  const mountExportNode = useCallback(
    (target: RenderTarget): Promise<HTMLDivElement> =>
      new Promise((resolve, reject) => {
        flushSync(() => setExportTarget(target));

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const node = exportRef.current;
            if (!node) {
              reject(new Error("Export node was not mounted."));
              return;
            }
            resolve(node);
          });
        });
      }),
    [],
  );

  const handleExport = useCallback(async () => {
    if (targets.length === 0) {
      setExportError("Pick at least one layout, a theme, and a size.");
      return;
    }

    setIsExporting(true);
    setExportError(null);
    setProgress({ done: 0, total: targets.length });

    const startedAt = Date.now();

    void trackEvent("export_started", {
      ad_count: targets.length,
      layout_count: layoutIds.length,
      theme_count: themeIds.length,
      size_count: sizeIds.length,
    });

    const files: Array<{ name: string; blob: Blob }> = [];

    try {
      await nextPaint();

      for (const [index, target] of targets.entries()) {
        const node = await mountExportNode(target);
        await waitForNodeAssets(node);

        const blob = await nodeToPngBlob(
          node,
          target.size.width,
          target.size.height,
        );

        files.push({
          name: renderTargetFilename(target, title),
          blob,
        });

        setProgress({ done: index + 1, total: targets.length });
      }

      const zip = await zipBlobs(files);
      downloadBlob(zip, `${toSlug(title)}-ad-pack.zip`);

      void trackEvent("export_completed", {
        ad_count: targets.length,
        duration_ms: Date.now() - startedAt,
      });
    } catch (error) {
      console.error("[export] failed", error);
      setExportError(
        "One of the ads couldn't be rendered. Re-upload the product image and try again.",
      );

      void trackEvent("export_failed", { ad_count: targets.length });
    } finally {
      setExportTarget(null);
      setIsExporting(false);
      setProgress(null);
    }
  }, [layoutIds, mountExportNode, sizeIds, targets, themeIds, title]);

  const canExport =
    !isExporting && targets.length > 0 && title.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Ad maker
        </h1>
        <p className="max-w-2xl text-neutral-600 dark:text-neutral-400">
          Paste a product link, check the details we found, and export a pack of
          branded ads as PNGs.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          {/* Step 1 - source */}
          <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">1. Product link</h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Works with most product pages. We read the link&apos;s public
                metadata, so details are a starting point you can edit.
              </p>
            </div>

            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!isScraping && url.trim()) void handleScrape();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="product-url">Product URL</Label>
                <Input
                  id="product-url"
                  fullWidth
                  placeholder="https://store.example.com/products/thing"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>

              <Button
                fullWidth
                isPending={isScraping}
                type="submit"
                variant="primary"
              >
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : null}
                    {isPending ? "Reading page..." : "Get product details"}
                  </>
                )}
              </Button>
            </form>

            {scrapeError ? (
              <p
                className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
                role="alert"
              >
                {scrapeError}
              </p>
            ) : null}
          </section>

          {/* Step 2 - details */}
          {product ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">2. Details</h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Scraped values are guesses. Fix anything that looks wrong.
                </p>
              </div>

              {product.missing.length > 0 ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  We couldn&apos;t find: {product.missing.join(", ")}. Add{" "}
                  {product.missing.length > 1 ? "them" : "it"} below or upload a
                  product image.
                </p>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="product-title">Title</Label>
                <Input
                  id="product-title"
                  fullWidth
                  maxLength={300}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="product-price">
                  Price
                  {product.currency ? ` (${product.currency})` : ""}
                </Label>
                <Input
                  id="product-price"
                  fullWidth
                  placeholder="49.00"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="product-description">
                  Description (optional)
                </Label>
                <textarea
                  id="product-description"
                  className="min-h-20 w-full resize-y rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base outline-none placeholder:text-neutral-500 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 dark:border-white/15"
                  maxLength={200}
                  placeholder="A short line about this product"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  Scraped descriptions are often generic store copy. Long text is
                  trimmed to fit each layout.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Product image</span>

                {imageStatus === "error" ? (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    That store blocked us from loading its image. Upload the
                    product photo instead.
                  </p>
                ) : null}

                <div className="flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    className="hidden"
                    type="file"
                    onChange={(event) => {
                      handleImageUpload(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => fileInputRef.current?.click()}
                  >
                    {uploadedImage ? "Replace image" : "Upload image"}
                  </Button>

                  {imageStatus === "ready" || uploadedImage ? (
                    <span className="text-sm text-neutral-600 dark:text-neutral-400">
                      Image ready
                    </span>
                  ) : imageStatus === "loading" ? (
                    <span className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                      <Spinner size="sm" /> Loading
                    </span>
                  ) : imageStatus === "idle" ? (
                    <span className="text-sm text-neutral-600 dark:text-neutral-400">
                      No image
                    </span>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* Step 3 - layout */}
          <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">3. Layout</h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                How the ad is composed.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {AD_LAYOUTS.map((layout) => (
                <Checkbox
                  key={layout.id}
                  isSelected={layoutIds.includes(layout.id)}
                  onChange={(selected) => toggleLayout(layout.id, selected)}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <span className="flex flex-col">
                      <span className="font-medium">{layout.name}</span>
                      <span className="text-sm text-neutral-600 dark:text-neutral-400">
                        {layout.description}
                      </span>
                    </span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          </section>

          {/* Step 4 - theme */}
          <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">4. Theme</h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                How the ad looks. Pick one for a consistent branded set, or
                several to compare styles.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {AD_THEMES.map((theme) => (
                <Checkbox
                  key={theme.id}
                  isSelected={themeIds.includes(theme.id)}
                  onChange={(selected) => toggleTheme(theme.id, selected)}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <span className="flex items-start gap-3">
                      <ThemeSwatch theme={theme} />
                      <span className="flex flex-col">
                        <span className="font-medium">
                          {theme.name}
                          {theme.font === "mono" ? (
                            <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs font-normal dark:bg-white/10">
                              mono
                            </span>
                          ) : null}
                        </span>
                        <span className="text-sm text-neutral-600 dark:text-neutral-400">
                          {theme.description}
                        </span>
                      </span>
                    </span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          </section>

          {/* Step 5 - sizes */}
          <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">5. Sizes</h2>
            </div>

            <div className="flex flex-col gap-3">
              {AD_SIZES.map((size) => (
                <Checkbox
                  key={size.id}
                  isSelected={sizeIds.includes(size.id)}
                  onChange={(selected) => toggleSize(size.id, selected)}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {size.label} · {size.ratioLabel}
                      </span>
                      <span className="text-sm text-neutral-600 dark:text-neutral-400">
                        {size.width} × {size.height} px
                      </span>
                    </span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          </section>

          {/* Step 6 - export */}
          <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">6. Export</h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {targets.length > 0
                  ? `${targets.length} ${targets.length === 1 ? "ad" : "ads"} ready as a .zip.`
                  : "Select at least one layout, one theme, and one size."}
              </p>
              {targets.length > LARGE_BATCH ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  That&apos;s a big batch. Rendering happens in your browser, so
                  it may take a minute.
                </p>
              ) : null}
            </div>

            <Button
              fullWidth
              isDisabled={!canExport}
              isPending={isExporting}
              variant="primary"
              onPress={() => void handleExport()}
            >
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  {isPending && progress
                    ? `Rendering ${progress.done}/${progress.total}...`
                    : `Download ${targets.length || ""} ads (.zip)`}
                </>
              )}
            </Button>

            {title.trim().length === 0 ? (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Add a title before exporting.
              </p>
            ) : null}

            {exportError ? (
              <p
                className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
                role="alert"
              >
                {exportError}
              </p>
            ) : null}
          </section>
        </div>

        {/* Previews */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Preview</h2>

          {targets.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-black/15 p-8 text-sm text-neutral-600 dark:border-white/20 dark:text-neutral-400">
              Select a layout, theme, and size to see previews.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-6">
                {targets.slice(0, MAX_PREVIEWS).map((target) => {
                  const scale = PREVIEW_WIDTH / target.size.width;

                  return (
                    <figure
                      key={`${target.layout.id}-${target.theme.id}-${target.size.id}`}
                      className="flex flex-col gap-2"
                    >
                      <div
                        className="overflow-hidden rounded-lg"
                        style={{
                          width: PREVIEW_WIDTH,
                          height: Math.round(target.size.height * scale),
                          boxShadow: "0 0 0 1px rgba(0,0,0,0.12)",
                        }}
                      >
                        <div
                          style={{
                            transform: `scale(${scale})`,
                            transformOrigin: "top left",
                          }}
                        >
                          <AdCanvas
                            content={content}
                            layout={target.layout}
                            size={target.size}
                            theme={target.theme}
                          />
                        </div>
                      </div>
                      <figcaption className="text-xs text-neutral-600 dark:text-neutral-400">
                        {target.layout.name} · {target.theme.name} ·{" "}
                        {target.size.label} ({target.size.ratioLabel})
                      </figcaption>
                    </figure>
                  );
                })}
              </div>

              {targets.length > MAX_PREVIEWS ? (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Showing the first {MAX_PREVIEWS} of {targets.length}{" "}
                  combinations to keep the page responsive. Every combination is
                  still exported.
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>

      {/*
        Off-screen export stage. Exactly one target is mounted here at a time so
        export memory stays flat regardless of how many ads are selected.
      */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: -20000,
          top: 0,
          pointerEvents: "none",
        }}
      >
        {exportTarget ? (
          <div ref={exportRef}>
            <AdCanvas
              content={content}
              layout={exportTarget.layout}
              size={exportTarget.size}
              theme={exportTarget.theme}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
