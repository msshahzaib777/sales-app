"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Kbd } from "@/components/ui/kbd";

import { rememberedList } from "./record-pager";

/**
 * Using Taqseem without a mouse. One listener for the whole website:
 *
 *   Esc          leave the box you are in; on a list, reset its search first; with nothing to
 *                leave or reset, go back to the page above (asks first when a form has unsaved
 *                changes)
 *   Alt+1 … 0    the sections of the side menu, in order
 *   Alt+N        the page's main "New …" button
 *   Ctrl+Enter   save the form you are in
 *   just type    on a list: goes into its search box, which filters as you type; on a long page
 *                (day-end, a trip): finds a customer on the page
 *   ↓ ↑          from a list search into the list's rows, and between rows; Enter opens one
 *   ?            the list of shortcuts
 *
 * Screens with their own keys (order entry, the drop-down lists) handle them first and mark the
 * event as handled (preventDefault), so nothing here runs twice. The keys are written next to
 * the actions (components/ui/kbd).
 */

const TYPING =
  "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]";

const isTyping = (el: Element | null) => Boolean(el?.matches(TYPING));

/**
 * Elements of the page on screen only. Next.js keeps the pages you came from in the document,
 * hidden, so going back is instant: their search boxes, buttons and forms must not answer keys.
 */
function onScreen<T extends Element>(selector: string): T[] {
  return [...document.querySelectorAll<T>(selector)].filter((el) => el.checkVisibility());
}
const first = <T extends Element>(selector: string): T | undefined => onScreen<T>(selector)[0];
const listSearch = () => first<HTMLInputElement>("main input[data-list-search]");
/** An open window or drop-down list on screen (the search window stays on the page, closed). */
const openOverlay = () =>
  Boolean(document.querySelector("dialog[open]")) ||
  [...document.querySelectorAll<HTMLElement>("[role=listbox], [role=dialog]")].some((el) =>
    el.checkVisibility(),
  );

/** Rows of the list the focused element is in (rows with a link), or of the page's first list. */
function listRows(from?: Element | null): HTMLAnchorElement[] {
  const table = from?.closest("table") ?? first("main table");
  if (!table) return [];
  return [...table.querySelectorAll("tbody tr")]
    .map((tr) => tr.querySelector<HTMLAnchorElement>("a[href]"))
    .filter((a): a is HTMLAnchorElement => a !== null);
}

/** Sets an uncontrolled box's text the way typing does, so its listeners (filtering) run. */
function setText(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const help = useRef<HTMLDialogElement>(null);
  const [find, setFind] = useState<string | null>(null);
  // When the page last changed: a list opened a moment ago may not be on screen yet.
  const pathname = usePathname();
  const lastNav = useRef(0);
  useEffect(() => {
    lastNav.current = Date.now();
  }, [pathname]);

  // Forms with unsaved changes: Esc asks before leaving them.
  useEffect(() => {
    const mark = (e: Event) => {
      const form = (e.target as Element | null)?.closest?.("form");
      if (form && form.getAttribute("role") !== "search") form.dataset.dirty = "1";
    };
    const clear = (e: Event) => delete (e.target as HTMLFormElement).dataset.dirty;
    document.addEventListener("input", mark, true);
    document.addEventListener("change", mark, true);
    document.addEventListener("submit", clear, true);
    return () => {
      document.removeEventListener("input", mark, true);
      document.removeEventListener("change", mark, true);
      document.removeEventListener("submit", clear, true);
    };
  }, []);

  useEffect(() => {
    const goBack = () => {
      if (
        first("main form[data-dirty]") &&
        !window.confirm("Leave this page? What you typed is not saved.")
      )
        return;
      const back = first<HTMLAnchorElement>("main [data-back-link]");
      // A record opened from a list goes back to that list with its search and filters.
      if (back) router.push(rememberedList(back.href) ?? back.getAttribute("href")!);
      else if (window.history.length > 1) router.back();
    };

    // Letters typed for a list's search are held for a moment and put into its box until it is
    // there and keeps them: just after opening a list (Alt+2, then the name straight away) the box
    // may not be on screen yet, or be replaced once while the list finishes loading.
    let held: { text: string; until: number } | null = null;
    let heldTimer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      if (!held) return;
      const box = listSearch();
      if (box) {
        if (document.activeElement !== box) box.focus();
        if (box.value !== held.text) setText(box, held.text);
      }
      if (Date.now() > held.until) held = null;
      else heldTimer = setTimeout(apply, 100);
    };
    const hold = (text: string) => {
      held = { text, until: Date.now() + 1000 };
      clearTimeout(heldTimer);
      apply();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const el = document.activeElement;
      const typing = isTyping(el);

      // Ctrl+Enter: save the form you are in.
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const form = el?.closest("form");
        if (form && form.getAttribute("role") !== "search") {
          e.preventDefault();
          form.requestSubmit();
        }
        return;
      }

      // Alt+1 … Alt+0: the side menu's sections.
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit\d$/.test(e.code)) {
        const link = document.querySelector<HTMLAnchorElement>(
          `nav[aria-label=Main] a[data-nav-key="${e.code.slice(5)}"]`,
        );
        if (link) {
          e.preventDefault();
          lastNav.current = Date.now();
          router.push(link.getAttribute("href")!);
        }
        return;
      }

      // Alt+N: the page's main "New …" button.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
        const link = first<HTMLElement>("main [data-shortcut=new]");
        if (link) {
          e.preventDefault();
          link.click();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (held) {
        if (e.key === "Backspace") {
          e.preventDefault();
          hold(held.text.slice(0, -1));
          return;
        }
        if (e.key.length === 1) {
          e.preventDefault();
          hold(held.text + e.key);
          return;
        }
        if (e.key === "Escape") held = null; // and Esc as usual: clears the box
      }

      if (e.key === "Escape") {
        if (openOverlay()) return; // the open list or window closes itself
        e.preventDefault();
        const search = listSearch();
        if (typing) {
          // A list search with text: clear it (the list shows everything again).
          if (search && el === search && search.value) setText(search, "");
          else (el as HTMLElement).blur();
          return;
        }
        // In a list's rows: back up to its search box.
        if (search && el?.closest("main table tbody")) {
          search.focus();
          return;
        }
        // A filtered list: Esc resets it to the full list first; only then goes back.
        if (search?.value) {
          setText(search, "");
          search.focus();
          return;
        }
        goBack();
        return;
      }

      // ↓ ↑: from a list search into its rows, and between rows (Enter opens the row).
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const search = listSearch();
        if (search && el === search && e.key === "ArrowDown") {
          const top = listRows()[0];
          if (top) {
            e.preventDefault();
            top.focus();
          }
          return;
        }
        if (el instanceof HTMLAnchorElement && el.closest("main table tbody")) {
          const rows = listRows(el);
          const i = rows.indexOf(el);
          if (i === -1) return;
          e.preventDefault();
          if (e.key === "ArrowDown") rows[Math.min(i + 1, rows.length - 1)]!.focus();
          else if (i > 0) rows[i - 1]!.focus();
          else search?.focus();
        }
        return;
      }

      if (typing || openOverlay()) return;

      if (e.key === "?") {
        e.preventDefault();
        help.current?.showModal();
        return;
      }

      // Just type: into the list's search box, or find on a long page.
      if (e.key.length === 1 && e.key !== "/" && e.key !== " ") {
        const search = listSearch();
        const findable = first("main [data-find]");
        // A list (or one still appearing, just after opening it): into its search box.
        if (search || (!findable && Date.now() - lastNav.current < 2000)) {
          e.preventDefault();
          hold((search?.value ?? "") + e.key);
          return;
        }
        if (findable) {
          e.preventDefault();
          setFind(e.key);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(heldTimer);
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  return (
    <>
      {find !== null ? <FindOnPage initial={find} onClose={() => setFind(null)} /> : null}
      <dialog
        ref={help}
        aria-labelledby="shortcuts-title"
        className="bg-background text-foreground m-auto max-w-lg rounded-lg border p-5 shadow-lg backdrop:bg-black/30"
        onClick={(e) => e.target === help.current && help.current?.close()}
      >
        <h2 id="shortcuts-title" className="mb-3 text-lg font-semibold">
          Keyboard shortcuts
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt className="text-right">
                <kbd className="rounded border px-1.5 text-xs">{keys}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-4 text-xs">
          The keys are also written next to the buttons. Press Esc to close.
        </p>
      </dialog>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Esc", "Leave the box, or reset a list search; again: back to the page above"],
  ["Alt+1 … Alt+0", "Open a section of the side menu"],
  ["Alt+N", "New (order, customer, payment …) on the page you are on"],
  ["Ctrl+Enter", "Save the form, book the order"],
  ["/  or  Ctrl+K", "Search everything"],
  ["Just type", "On a list: search it. On day-end or a trip: find a customer"],
  ["↓  ↑  Enter", "Move through a list and open a row"],
  ["Alt+↑  Alt+↓", "On a record opened from a list: previous / next record"],
  ["Tab", "Next box. In an order: after the dozens and the rate, the next product"],
  ["Enter", "In an order: after the dozens, the next product"],
  ["Ctrl+Delete", "In an order: remove the line you are in"],
  ["Alt+R", "In an order: change the rate of the line you are in"],
  ["Alt+L", "In an order: repeat the customer's last order"],
  ["?", "This list"],
];

/**
 * Find a customer on a long page (day-end, a trip): sections marked data-find="name shop …".
 * Enter: next match, Shift+Enter: previous, Tab: into the match's boxes, Esc: close.
 */
function FindOnPage({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [query, setQuery] = useState(initial);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Rendered only after a key press in the browser, so reading the page here is safe.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return onScreen<HTMLElement>("main [data-find]").filter((el) =>
      el.dataset.find!.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    const box = input.current;
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, []);

  const current = matches[index];
  useEffect(() => {
    for (const el of document.querySelectorAll("[data-found]")) el.removeAttribute("data-found");
    if (current) {
      current.setAttribute("data-found", "");
      current.scrollIntoView({ block: "center" });
    }
    return () => current?.removeAttribute("data-found");
  }, [current]);

  return (
    <div
      role="search"
      className="bg-background fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-lg border p-2 shadow-lg print:hidden"
    >
      <label htmlFor="find-on-page" className="text-sm font-medium">
        Find
      </label>
      <input
        ref={input}
        id="find-on-page"
        value={query}
        autoComplete="off"
        className="border-input h-8 w-48 rounded-md border px-2 text-sm"
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter" && matches.length) {
            e.preventDefault();
            setIndex((i) => (i + (e.shiftKey ? matches.length - 1 : 1)) % matches.length);
          } else if (e.key === "Tab" && !e.shiftKey && current) {
            e.preventDefault();
            onClose();
            current
              .querySelector<HTMLElement>(
                "input:not([type=hidden]):not([disabled]), select, textarea, button, a[href]",
              )
              ?.focus();
          }
        }}
      />
      <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
        {query.trim() ? (matches.length ? `${index + 1} of ${matches.length}` : "No match") : ""}
      </span>
      <span className="text-muted-foreground text-xs pointer-coarse:hidden" aria-hidden>
        <Kbd>Enter</Kbd> next · <Kbd>Tab</Kbd> go in · <Kbd>Esc</Kbd> close
      </span>
    </div>
  );
}
