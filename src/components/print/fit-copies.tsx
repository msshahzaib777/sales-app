"use client";

import { useEffect } from "react";

import { COPY_MIN_FONT_PT } from "@/lib/print";

/**
 * Two copies per A5: a long bill shrinks its text just enough to fit its half (down to
 * COPY_MIN_FONT_PT), instead of being cut off. Runs on screen (the preview has the printed size)
 * and again just before printing. Renders nothing.
 */
export function FitCopies({ fontPt }: { fontPt: number }) {
  useEffect(() => {
    const fit = () => {
      for (const bill of document.querySelectorAll<HTMLElement>(".print-bill[data-fit]")) {
        let size = fontPt;
        bill.style.fontSize = `${size}pt`;
        while (bill.scrollHeight > bill.clientHeight + 1 && size > COPY_MIN_FONT_PT) {
          size = Math.max(COPY_MIN_FONT_PT, size - 0.5);
          bill.style.fontSize = `${size}pt`;
        }
      }
    };
    fit();
    // Fonts arrive a moment after the page: measure again once they are in.
    void document.fonts?.ready.then(fit);
    window.addEventListener("beforeprint", fit);
    return () => window.removeEventListener("beforeprint", fit);
  }, [fontPt]);
  return null;
}
