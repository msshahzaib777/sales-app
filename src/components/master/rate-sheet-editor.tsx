"use client";

import { useActionState, useMemo, useState } from "react";

import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { NativeSelect } from "@/components/ui/native-select";
import { type ActionState, idleState } from "@/lib/action-state";
import { shortMoney } from "@/lib/rate-sheet";
import type { RateColumn, RateRow } from "@/server/services/master/rate-sheet";

type Edits = Record<string, Partial<Record<RateColumn, string>>>;

const LABELS: Record<RateColumn, string> = {
  purchaseRate: "Purchase rate",
  saleRate: "Sale rate",
  discount: "Discount",
  slabs: "Quantity slabs",
  minStock: "Min stock (dz)",
};
const HINTS: Record<RateColumn, string> = {
  purchaseRate: "Rs per dozen",
  saleRate: "Rs per dozen",
  discount: "5% · 5 = Rs 5/dz · blank",
  slabs: "dozens=discount, in the discount's unit (% or Rs): 25=3, 50=5",
  minStock: "dozens",
};

/**
 * Products → Edit rates: every product in one grid. Type in the cells (Tab across, Enter / ↓ / ↑
 * down and up the column); changed cells are highlighted; bulk changes fill the selected rows'
 * cells, to check before saving; one Save (Ctrl+Enter) saves everything, or nothing if a cell is
 * wrong (its problem is shown under it).
 */
export function RateSheetEditor({
  rows,
  companies,
  showCost,
  action,
}: {
  rows: RateRow[];
  companies: { id: string; name: string }[];
  showCost: boolean;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const columns: RateColumn[] = showCost
    ? ["purchaseRate", "saleRate", "discount", "slabs", "minStock"]
    : ["saleRate", "discount", "slabs", "minStock"];
  const [edits, setEdits] = useState<Edits>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await action(prev, formData);
      // Saved: the sheet shows the new values from the server; nothing is pending any more.
      if (result.status === "success") setEdits({});
      return result;
    },
    idleState,
  );

  const value = (row: RateRow, col: RateColumn) => edits[row.id]?.[col] ?? row[col];
  const isChanged = (row: RateRow, col: RateColumn) =>
    edits[row.id]?.[col] !== undefined && edits[row.id]![col]!.trim() !== row[col];
  const errorOf = (row: RateRow, col: RateColumn) =>
    state.status === "error" ? state.fieldErrors?.[`${row.id}.${col}`]?.[0] : undefined;

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter(
      (r) =>
        (!companyId || r.companyId === companyId) &&
        words.every((w) => `${r.code} ${r.name}`.toLowerCase().includes(w)),
    );
  }, [rows, companyId, search]);

  const changes = rows
    .map((r) => {
      const changed = Object.fromEntries(
        columns.filter((c) => isChanged(r, c)).map((c) => [c, value(r, c).trim()]),
      );
      return Object.keys(changed).length ? { productId: r.id, ...changed } : null;
    })
    .filter(Boolean);
  const changedCells = changes.reduce((n, c) => n + Object.keys(c!).length - 1, 0);

  const set = (id: string, col: RateColumn, v: string) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [col]: v } }));

  // Bulk: fills the selected rows' cells (shown highlighted), saved with the rest.
  const targets = shown.filter((r) => selected.has(r.id));
  const [bulkField, setBulkField] = useState<"saleRate" | "purchaseRate">("saleRate");
  const [bulkMode, setBulkMode] = useState<"add" | "set">("add");
  const [bulkAmount, setBulkAmount] = useState("");
  const [bulkDiscount, setBulkDiscount] = useState("");
  const amount = Number(bulkAmount);
  const applyRate = () => {
    if (!bulkAmount.trim() || !Number.isFinite(amount)) return;
    setEdits((e) => {
      const next = { ...e };
      for (const r of targets) {
        const current = Number(value(r, bulkField));
        const v = bulkMode === "add" ? Math.max(0, current + amount) : amount;
        next[r.id] = { ...next[r.id], [bulkField]: shortMoney(v.toFixed(2)) };
      }
      return next;
    });
  };
  const applyDiscount = () =>
    setEdits((e) => {
      const next = { ...e };
      for (const r of targets) next[r.id] = { ...next[r.id], discount: bulkDiscount.trim() };
      return next;
    });

  // Enter / ↓ / ↑: the same column in the next or previous row on screen.
  const move = (index: number, col: RateColumn, by: number) => {
    document.getElementById(`cell-${index + by}-${col}`)?.focus();
  };

  const allShown = shown.length > 0 && shown.every((r) => selected.has(r.id));
  return (
    <form
      action={formAction}
      className="space-y-4"
      onKeyDown={(e) => {
        // Plain Enter never saves the sheet by accident (Ctrl+Enter does); in the bulk boxes it
        // applies the bulk change.
        if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
        const target = e.target as HTMLElement;
        if (!(target instanceof HTMLInputElement)) return;
        e.preventDefault();
        if (target.dataset.bulk === "rate" && targets.length) applyRate();
        if (target.dataset.bulk === "discount" && targets.length) applyDiscount();
      }}
    >
      <input type="hidden" name="changes" value={JSON.stringify(changes)} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="rs-company" className="text-muted-foreground text-xs font-medium">
            Company
          </label>
          <NativeSelect
            id="rs-company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-56"
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="rs-search" className="text-muted-foreground text-xs font-medium">
            Search
          </label>
          <Input
            id="rs-search"
            type="search"
            autoComplete="off"
            placeholder="Code or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending || changes.length === 0}>
          {pending
            ? "Saving…"
            : changedCells
              ? `Save ${changedCells} ${changedCells === 1 ? "change" : "changes"}`
              : "Save"}
        </Button>
        {changes.length ? (
          <Button type="button" variant="ghost" onClick={() => setEdits({})}>
            Undo all
          </Button>
        ) : null}
      </div>
      <FormMessage state={state} />

      <section
        aria-label="Bulk change"
        className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-lg border p-3 text-sm"
      >
        <p className="w-full font-medium sm:w-auto sm:self-center">
          {targets.length
            ? `${targets.length} selected`
            : "Select rows (or all shown) for a bulk change"}
        </p>
        <div className="flex items-end gap-2">
          <NativeSelect
            aria-label="Rate to change"
            value={bulkField}
            onChange={(e) => setBulkField(e.target.value as "saleRate" | "purchaseRate")}
            className="w-36"
          >
            <option value="saleRate">Sale rate</option>
            {showCost ? <option value="purchaseRate">Purchase rate</option> : null}
          </NativeSelect>
          <NativeSelect
            aria-label="How"
            value={bulkMode}
            onChange={(e) => setBulkMode(e.target.value as "add" | "set")}
            className="w-40"
          >
            <option value="add">Up / down by Rs</option>
            <option value="set">Set to Rs</option>
          </NativeSelect>
          <Input
            aria-label="Amount"
            data-bulk="rate"
            inputMode="decimal"
            placeholder={bulkMode === "add" ? "e.g. 10 or -5" : "e.g. 120"}
            value={bulkAmount}
            onChange={(e) => setBulkAmount(e.target.value)}
            className="w-32"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!targets.length || !bulkAmount.trim() || !Number.isFinite(amount)}
            onClick={applyRate}
          >
            Apply
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Input
            aria-label="Discount for the selected"
            data-bulk="discount"
            placeholder="Discount: 5% or 5 or blank"
            value={bulkDiscount}
            onChange={(e) => setBulkDiscount(e.target.value)}
            className="w-48"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!targets.length}
            onClick={applyDiscount}
          >
            Set discount
          </Button>
        </div>
      </section>

      <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs pointer-coarse:hidden">
        <span>
          <Kbd>Tab</Kbd> next cell
        </span>
        <span>
          <Kbd>Enter</Kbd> <Kbd>↓</Kbd> <Kbd>↑</Kbd> down / up the column
        </span>
        <span>
          <Kbd>Ctrl+Enter</Kbd> save
        </span>
        <span>Changed cells are highlighted; nothing is saved until you press Save.</span>
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-8 px-2 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allShown}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      for (const r of shown) {
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                      }
                      return next;
                    })
                  }
                  className="size-4"
                />
              </th>
              <th className="px-2 py-2 text-left font-medium">Product</th>
              {columns.map((c) => (
                <th key={c} className="px-2 py-2 text-left font-medium">
                  {LABELS[c]}
                  <div className="text-muted-foreground text-xs font-normal">{HINTS[c]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="text-muted-foreground px-2 py-6 text-center"
                >
                  No products match.
                </td>
              </tr>
            ) : null}
            {shown.map((r, i) => (
              <tr key={r.id} className="border-t align-top">
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.name}`}
                    checked={selected.has(r.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      })
                    }
                    className="size-4"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <span className="font-mono">{r.code}</span> {r.name}
                  <div className="text-muted-foreground text-xs">{r.companyName}</div>
                </td>
                {columns.map((c) => {
                  const error = errorOf(r, c);
                  return (
                    <td key={c} className="px-1 py-1">
                      <Input
                        id={`cell-${i}-${c}`}
                        aria-label={`${LABELS[c]} of ${r.name}`}
                        aria-invalid={error ? true : undefined}
                        autoComplete="off"
                        inputMode={c === "slabs" || c === "discount" ? "text" : "decimal"}
                        value={value(r, c)}
                        onChange={(e) => set(r.id, c, e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            (e.key === "Enter" && !e.ctrlKey && !e.metaKey) ||
                            e.key === "ArrowDown"
                          ) {
                            e.preventDefault();
                            move(i, c, 1);
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            move(i, c, -1);
                          }
                        }}
                        className={`h-8 ${c === "slabs" ? "min-w-40" : "min-w-20"} ${
                          isChanged(r, c) ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40" : ""
                        }`}
                      />
                      {error ? <p className="text-destructive mt-0.5 text-xs">{error}</p> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
