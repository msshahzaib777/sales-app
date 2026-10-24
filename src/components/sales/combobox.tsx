"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Keyboard-first search box with a pick list: type to filter, ↑/↓ to move, Enter to pick, Esc to
 * close. With one match, Enter picks it straight away.
 */
export function Combobox<T>({
  label,
  items,
  getKey,
  render,
  rank,
  onSelect,
  placeholder,
  inputRef,
  autoFocus,
  emptyText = "No matches",
  limit = 8,
  hint,
}: {
  label: string;
  items: T[];
  getKey: (item: T) => string;
  render: (item: T) => React.ReactNode;
  /** 0 = no match; higher ranks first. */
  rank: (item: T, query: string) => number;
  onSelect: (item: T) => void;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
  emptyText?: string;
  limit?: number;
  hint?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = query.trim().toLowerCase();
  const results = (
    q
      ? items
          .map((item) => ({ item, score: rank(item, q) }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((r) => r.item)
      : items
  ).slice(0, limit);
  const showList = open && q.length > 0;

  const pick = (item: T) => {
    onSelect(item);
    setQuery("");
    setOpen(false);
    setActive(0);
  };

  return (
    <div className="relative space-y-1.5">
      <Label htmlFor={`${id}-input`}>{label}</Label>
      <Input
        id={`${id}-input`}
        ref={inputRef}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${id}-opt-${active}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const item = results[active];
            if (showList && item) pick(item);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {showList ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="bg-popover absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border py-1 shadow-md"
        >
          {results.length === 0 ? (
            <li className="text-muted-foreground px-3 py-2 text-sm">{emptyText}</li>
          ) : null}
          {results.map((item, i) => (
            <li
              key={getKey(item)}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "cursor-pointer px-3 py-1.5 text-sm",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              {render(item)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Ranking for code/name search: exact code > code prefix > word prefix > contains. */
export function rankText(
  query: string,
  code: string | null,
  ...texts: (string | null | undefined)[]
): number {
  const c = (code ?? "").toLowerCase();
  if (c && c === query) return 100;
  if (c && c.startsWith(query)) return 80;
  let best = 0;
  for (const t of texts) {
    const text = (t ?? "").toLowerCase();
    if (!text) continue;
    if (text.startsWith(query)) best = Math.max(best, 60);
    else if (text.split(/\s+/).some((w) => w.startsWith(query))) best = Math.max(best, 40);
    else if (text.includes(query)) best = Math.max(best, 20);
  }
  return best;
}
