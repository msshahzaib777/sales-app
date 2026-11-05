"use client";

import { useEffect } from "react";

import { COPY_MIN_FONT_PT } from "@/lib/print";

/**
 * Shrinks the text of fixed-size boxes just enough for their content to fit (down to `minPt`),
 * instead of cutting it off or spilling onto another page. Runs on screen (the preview has the
 * printed size), once the fonts are in, and again just before printing. Renders nothing.
 */
export function FitText({
  selector,
  fontPt,
  minPt,
}: {
  selector: string;
  fontPt: number;
  minPt: number;
}) {
  useEffect(() => {
    const fit = () => {
      for (const box of document.querySelectorAll<HTMLElement>(selector)) {
        let size = fontPt;
        box.style.fontSize = `${size}pt`;
        while (box.scrollHeight > box.clientHeight + 1 && size > minPt) {
          size = Math.max(minPt, size - 0.5);
          box.style.fontSize = `${size}pt`;
        }
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    window.addEventListener("beforeprint", fit);
    return () => window.removeEventListener("beforeprint", fit);
  }, [selector, fontPt, minPt]);
  return null;
}

/** Two copies per A5: a long bill shrinks its text to fit its half (down to COPY_MIN_FONT_PT). */
export function FitCopies({ fontPt }: { fontPt: number }) {
  return <FitText selector=".print-bill[data-fit]" fontPt={fontPt} minPt={COPY_MIN_FONT_PT} />;
}
