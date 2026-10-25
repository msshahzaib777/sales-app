"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { globalSearchAction } from "@/server/search-actions";
import type { SearchHit } from "@/server/services/search";

/**
 * Search from anywhere: "/" or Ctrl+K opens it (when not typing in a box), or the button. Results
 * come as you type; ↑ ↓ choose, Enter opens, Esc closes.
 */
export function GlobalSearch() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searching, startSearch] = useTransition();
  const latest = useRef(0);

  const open = () => {
    dialog.current?.showModal();
    input.current?.select();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName ?? "");
      if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search a moment after typing stops; only the newest answer is shown.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const result = await globalSearchAction(q);
        if (id === latest.current) {
          setHits(result);
          setActive(0);
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    dialog.current?.close();
    router.push(hit.href);
  };

  const shown = query.trim() ? hits : [];
  return (
    <>
      <button
        type="button"
        onClick={open}
        title="Search (/)"
        aria-label="Search"
        aria-keyshortcuts="/ Control+K"
        className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex w-full items-center gap-3 rounded-md border px-3 py-1.5 text-sm outline-none group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:border-0 group-data-[collapsed=true]/sidebar:px-0 focus-visible:ring-2 max-md:justify-center max-md:border-0 max-md:px-0"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left group-data-[collapsed=true]/sidebar:sr-only max-md:sr-only">
          Search
        </span>
        <kbd className="text-muted-foreground rounded border px-1.5 text-xs group-data-[collapsed=true]/sidebar:hidden max-md:hidden">
          /
        </kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label="Search"
        className="bg-background text-foreground mx-auto mt-[10vh] w-[min(40rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-xl backdrop:bg-black/40"
        onClick={(e) => {
          // A click on the dark backdrop (outside the box) closes it.
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex items-center gap-2 border-b p-2">
          <Search className="text-muted-foreground ml-1 size-4 shrink-0" aria-hidden />
          <Input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(shown[active]);
              }
            }}
            placeholder="Customer, order no., product, company, trip no."
            aria-label="Search"
            aria-controls="global-search-results"
            aria-activedescendant={shown[active] ? `search-hit-${active}` : undefined}
            className="h-10 border-0 text-base shadow-none focus-visible:ring-0"
            autoComplete="off"
          />
          <kbd className="text-muted-foreground hidden rounded border px-1.5 text-xs sm:block">
            Esc
          </kbd>
        </div>
        <ul id="global-search-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-1">
          {query.trim() && !searching && shown.length === 0 ? (
            <li className="text-muted-foreground p-3 text-sm">Nothing found.</li>
          ) : null}
          {!query.trim() ? (
            <li className="text-muted-foreground p-3 text-sm">
              Type a name, shop, phone, product code, or a number like #12. Words can be in any
              order.
            </li>
          ) : null}
          {shown.map((hit, i) => (
            <li
              key={hit.href + hit.title}
              id={`search-hit-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
              className={cn(
                "flex cursor-pointer items-baseline gap-3 rounded-md px-3 py-2",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              <span className="text-muted-foreground w-16 shrink-0 text-xs">{hit.kind}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{hit.title}</span>
                {hit.detail ? (
                  <span className="text-muted-foreground block truncate text-xs">{hit.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
