"use client";

import { toBlob } from "html-to-image";
import JSZip from "jszip";

/**
 * Client-side export.
 *
 * Rendering happens in the user's browser, which keeps headless-browser
 * infrastructure out of the request path entirely. The tradeoff is that export
 * quality depends on the local environment, so every step here waits on the
 * real resource (fonts, images) rather than assuming it resolved.
 */

/** Waits for the browser to paint the state React just committed. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Blocks until webfonts and every <img> inside the node has decoded.
 * Without this, exports intermittently capture a fallback font or a blank
 * image slot.
 */
export async function waitForNodeAssets(node: HTMLElement): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    // Font loading API unavailable - carry on with whatever is rendered.
  }

  const images = Array.from(node.querySelectorAll("img"));

  await Promise.all(
    images.map(async (image) => {
      if (!image.complete || image.naturalWidth === 0) {
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }

      try {
        await image.decode();
      } catch {
        // A broken image is reported by the caller, not here.
      }
    }),
  );
}

export async function nodeToPngBlob(
  node: HTMLElement,
  width: number,
  height: number,
): Promise<Blob> {
  const blob = await toBlob(node, {
    width,
    height,
    // 1:1 against the template's pixel dimensions. The template already
    // renders at export resolution, so extra pixelRatio only inflates memory.
    pixelRatio: 1,
    cacheBust: false,
    // Neutralise any wrapper transform so the clone is captured unscaled.
    style: { transform: "none", margin: "0", transformOrigin: "top left" },
  });

  if (!blob) {
    throw new Error("Export produced no image data.");
  }

  return blob;
}

export async function zipBlobs(
  files: Array<{ name: string; blob: Blob }>,
): Promise<Blob> {
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.name, file.blob);
  }

  // PNGs are already compressed; STORE avoids pointless CPU on large batches.
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "ads"
  );
}
