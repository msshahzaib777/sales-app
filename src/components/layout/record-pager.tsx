"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { Kbd } from "@/components/ui/kbd";

/**
 * Previous / next on a record's page (an order, a trip, a product, a customer …), in the order of
 * the list it was opened from, with that list's search and filters: opening a row from a list
 * remembers the list's rows (for this browser tab), and the record's page steps through them
 * with Alt+↑ / Alt+↓ (Alt+← / Alt+→ are the browser's back and forward). The back link and Esc
 * return to that same filtered list. Shown next to the page's back link.
 */

const KEY = "taqseem.list";
const CHANGED = "taqseem:list-changed";

type Remembered = {
  /** The list's address, with its search and filters. */
  list: string;
  /** The records' pages, in the list's order. */
  items: string[];
};

function read(raw: string | null): Remembered | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Remembered;
    return Array.isArray(value.items) && typeof value.list === "string" ? value : null;
  } catch {
    return null;
  }
}

const storage = {
  get: (): string | null => {
    try {
      return window.sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(value: Remembered) {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(value));
      window.dispatchEvent(new Event(CHANGED));
    } catch {
      // Private window or storage off: previous / next is simply not offered.
    }
  },
  subscribe(onChange: () => void) {
    window.addEventListener(CHANGED, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CHANGED, onChange);
      window.removeEventListener("storage", onChange);
    };
  },
};

const pathOf = (href: string) => new URL(href, window.location.href).pathname;

/**
 * Mounted once for the whole website: remembers a list when one of its rows is opened, and sends
 * the back link to that list with its filters. Renders nothing.
 */
export function ListMemory() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;

      // The back link of a record opened from a list: back to that list, filters included.
      if (link.hasAttribute("data-back-link")) {
        const memory = read(storage.get());
        if (memory && pathOf(memory.list) === pathOf(link.href)) {
          e.preventDefault();
          router.push(memory.list);
        }
        return;
      }

      // A row of a list: remember the list's rows, in order.
      const table = link.closest("main table");
      if (!table || !link.closest("tbody tr")) return;
      const items = [...table.querySelectorAll("tbody tr")]
        .map((tr) => tr.querySelector<HTMLAnchorElement>("a[href]"))
        .filter((a): a is HTMLAnchorElement => a !== null)
        .map((a) => pathOf(a.href));
      const unique = [...new Set(items)];
      if (unique.length < 2 || !unique.includes(pathOf(link.href))) return;
      storage.set({ list: window.location.pathname + window.location.search, items: unique });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);
  return null;
}

/** The address of the list a back link should return to (with its filters), if remembered. */
export function rememberedList(backHref: string): string | null {
  const memory = read(storage.get());
  return memory && pathOf(memory.list) === pathOf(backHref) ? memory.list : null;
}

/** "‹ Previous · 3 of 50 · Next ›" for the record on screen, when it was opened from a list. */
export function RecordPager() {
  const pathname = usePathname();
  const router = useRouter();
  const raw = useSyncExternalStore(storage.subscribe, storage.get, () => null);
  const place = useMemo(() => {
    const memory = read(raw);
    const index = memory ? memory.items.indexOf(pathname) : -1;
    if (!memory || index === -1) return null;
    return {
      index,
      total: memory.items.length,
      previous: memory.items[index - 1],
      next: memory.items[index + 1],
    };
  }, [raw, pathname]);

  // To another record; a form on this one with unsaved changes asks first (as Esc does).
  const go = (to: string | undefined) => {
    if (!to) return;
    const unsaved = [...document.querySelectorAll("main form[data-dirty]")].some((f) =>
      f.checkVisibility(),
    );
    if (unsaved && !window.confirm("Leave this page? What you typed is not saved.")) return;
    router.push(to);
  };

  useEffect(() => {
    if (!place) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      // In a drop-down box, Alt+↓ opens its list.
      if (document.activeElement instanceof HTMLSelectElement) return;
      e.preventDefault();
      go(e.key === "ArrowUp" ? place.previous : place.next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!place) return null;
  const step =
    "text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 disabled:opacity-40";
  return (
    <span
      className="ml-4 inline-flex items-center gap-3 print:hidden"
      aria-label="Previous and next"
    >
      <button
        type="button"
        className={step}
        disabled={!place.previous}
        aria-keyshortcuts="Alt+ArrowUp"
        onClick={() => go(place.previous)}
      >
        ‹ Previous <Kbd>Alt+↑</Kbd>
      </button>
      <span className="text-muted-foreground tabular-nums">
        {place.index + 1} of {place.total}
      </span>
      <button
        type="button"
        className={step}
        disabled={!place.next}
        aria-keyshortcuts="Alt+ArrowDown"
        onClick={() => go(place.next)}
      >
        Next › <Kbd>Alt+↓</Kbd>
      </button>
    </span>
  );
}
