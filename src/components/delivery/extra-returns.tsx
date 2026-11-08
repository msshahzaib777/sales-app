"use client";

import Decimal from "decimal.js";
import { useEffect, useRef } from "react";

import { Combobox, rankText } from "@/components/sales/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { formatDozens, PACKETS_PER_DOZEN, parseQuantity } from "@/lib/units";

// Day-end: goods from an earlier sale the customer gives back (not on today's order). Any product
// at a rate agreed for the return (starts at what the customer last paid), or "Other" for
// something not in the list (e.g. discontinued) with a description, its company and a custom rate.

export type ReturnProduct = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  companyId: string;
  companyName: string;
  /** Normal rate per dozen after the product's discount. */
  rate: string;
};
export type ReturnOptions = {
  products: ReturnProduct[];
  companies: { id: string; name: string }[];
};

export type ExtraRow = {
  key: string;
  /** Null for "Other". */
  productId: string | null;
  companyId: string;
  description: string;
  qty: string;
  rate: string;
  damaged: boolean;
};

const OTHER = "__other__";
const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim().replace(/,/g, ""));

/** One row's quantity (packets), credit and whether it can be saved as typed. */
export function extraFigures(row: ExtraRow) {
  const packets = row.qty.trim() === "" ? null : parseQuantity(row.qty);
  const rateOk = isMoney(row.rate);
  const bad =
    !packets || !rateOk || (row.productId === null && (!row.description.trim() || !row.companyId));
  const amount =
    packets && rateOk
      ? new Decimal(packets)
          .div(PACKETS_PER_DOZEN)
          .mul(row.rate.trim().replace(/,/g, ""))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : null;
  return { packets, amount, bad };
}

/** Total credit for the returns, and whether any row still needs fixing. */
export function extrasTotal(rows: ExtraRow[]) {
  let credit = new Decimal(0);
  let bad = false;
  for (const r of rows) {
    const f = extraFigures(r);
    if (f.bad) bad = true;
    if (f.amount) credit = credit.add(f.amount);
  }
  return { credit, bad };
}

export function ExtraReturns({
  rows,
  onChange,
  options,
  lastRates,
  prefix = "",
  idPrefix,
  error,
}: {
  rows: ExtraRow[];
  onChange: (change: (rows: ExtraRow[]) => ExtraRow[]) => void;
  options: ReturnOptions;
  /** This customer's last rate per dozen by product. */
  lastRates: Record<string, string>;
  /** Form field prefix, e.g. "o:<orderId>:" on the trip page. */
  prefix?: string;
  idPrefix: string;
  error: (field: string) => string | undefined;
}) {
  // A row just added: its first box gets the focus once it is on the page.
  const focusKey = useRef<string | null>(null);
  useEffect(() => {
    if (!focusKey.current) return;
    document.getElementById(`${idPrefix}-x-${focusKey.current}-first`)?.focus();
    focusKey.current = null;
  });

  const products = new Map(options.products.map((p) => [p.id, p]));
  type Other = { id: typeof OTHER; other: true };
  type Item = ReturnProduct | Other;
  const isOther = (item: Item): item is Other => "other" in item;
  const items: Item[] = [...options.products, { id: OTHER, other: true }];

  const add = (row: Omit<ExtraRow, "key">) => {
    const key = crypto.randomUUID().slice(0, 8);
    onChange((all) => [...all, { ...row, key }]);
    focusKey.current = key;
  };
  const addOther = () =>
    add({ productId: null, companyId: "", description: "", qty: "", rate: "", damaged: false });
  const set = (key: string, change: Partial<ExtraRow>) =>
    onChange((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const name = (field: string) => `${prefix}extra.${field}`;

  return (
    <section className="space-y-2" aria-labelledby={`${idPrefix}-extra-heading`}>
      <div>
        <h3 id={`${idPrefix}-extra-heading`} className="text-sm font-medium">
          Returns of earlier goods
        </h3>
        <p className="text-muted-foreground text-xs">
          Anything else the customer gave back (from an earlier bill): credited to the customer at
          the rate you enter. Products go back into stock; &ldquo;Other&rdquo; is for something not
          in the list.
        </p>
      </div>

      {rows.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {rows.map((r, i) => {
            const p = r.productId ? products.get(r.productId) : null;
            const f = extraFigures(r);
            const err = (field: string) => error(`extras.${i}.${field}`);
            const id = (field: string) => `${idPrefix}-x-${r.key}-${field}`;
            return (
              <li
                key={r.key}
                className="grid gap-2 p-2 sm:grid-cols-[1fr_7rem_7rem_9rem_6rem_auto] sm:items-start"
              >
                <input type="hidden" name={name("kind")} value={p ? "product" : "other"} />
                <input type="hidden" name={name("productId")} value={r.productId ?? ""} />
                <input type="hidden" name={name("damaged")} value={r.damaged ? "1" : ""} />
                {p ? (
                  <div>
                    <input type="hidden" name={name("companyId")} value="" />
                    <input type="hidden" name={name("description")} value="" />
                    <p className="text-sm font-medium">
                      {p.code} {p.name}
                      {p.active ? "" : " (inactive)"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {p.companyName}
                      {lastRates[p.id] ? ` · last paid Rs ${lastRates[p.id]}/dz` : ""}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label htmlFor={id("first")} className="text-muted-foreground text-xs">
                        Other: what is it?
                      </label>
                      <Input
                        id={id("first")}
                        name={name("description")}
                        value={r.description}
                        maxLength={120}
                        autoComplete="off"
                        aria-invalid={
                          err("description") || !r.description.trim() ? true : undefined
                        }
                        className="h-9 text-sm"
                        onChange={(e) => set(r.key, { description: e.target.value })}
                      />
                      {err("description") ? (
                        <p className="text-destructive text-xs">{err("description")}</p>
                      ) : null}
                    </div>
                    <div>
                      <label htmlFor={id("company")} className="text-muted-foreground text-xs">
                        Company
                      </label>
                      <select
                        id={id("company")}
                        name={name("companyId")}
                        value={r.companyId}
                        aria-invalid={err("companyId") || !r.companyId ? true : undefined}
                        className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                        onChange={(e) => set(r.key, { companyId: e.target.value })}
                      >
                        <option value="">Choose…</option>
                        {options.companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {err("companyId") ? (
                        <p className="text-destructive text-xs">{err("companyId")}</p>
                      ) : null}
                    </div>
                  </div>
                )}
                <div>
                  <label
                    htmlFor={p ? id("first") : id("qty")}
                    className="text-muted-foreground text-xs"
                  >
                    Quantity
                  </label>
                  <Input
                    id={p ? id("first") : id("qty")}
                    name={name("quantity")}
                    value={r.qty}
                    placeholder="dz"
                    autoComplete="off"
                    aria-invalid={
                      err("quantity") || (r.qty.trim() && !f.packets) ? true : undefined
                    }
                    className="h-9 text-sm"
                    onChange={(e) => set(r.key, { qty: e.target.value })}
                  />
                  {err("quantity") ? (
                    <p className="text-destructive text-xs">{err("quantity")}</p>
                  ) : f.packets ? (
                    <p className="text-muted-foreground text-xs tabular-nums">
                      = {formatDozens(f.packets)}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor={id("rate")} className="text-muted-foreground text-xs">
                    Rate per dozen
                  </label>
                  <Input
                    id={id("rate")}
                    name={name("rate")}
                    value={r.rate}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-invalid={
                      err("rate") || (r.rate.trim() && !isMoney(r.rate)) ? true : undefined
                    }
                    className="h-9 text-sm"
                    onChange={(e) => set(r.key, { rate: e.target.value })}
                  />
                  {err("rate") ? <p className="text-destructive text-xs">{err("rate")}</p> : null}
                </div>
                <div>
                  {p ? (
                    <>
                      <label htmlFor={id("cond")} className="text-muted-foreground text-xs">
                        Goes to
                      </label>
                      <select
                        id={id("cond")}
                        value={r.damaged ? "1" : ""}
                        className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                        onChange={(e) => set(r.key, { damaged: e.target.value === "1" })}
                      >
                        <option value="">Saleable stock</option>
                        <option value="1">Damaged stock</option>
                      </select>
                    </>
                  ) : (
                    <p className="text-muted-foreground pt-5 text-xs">No stock (not in the list)</p>
                  )}
                </div>
                <p className="pt-5 text-right text-sm tabular-nums">
                  {f.amount ? formatMoney(f.amount.toFixed(2)) : "—"}
                </p>
                <div className="pt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${p ? p.name : "other return"}`}
                    onClick={() => onChange((all) => all.filter((x) => x.key !== r.key))}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="max-w-md">
        <Combobox<Item>
          label="Add a returned item"
          items={items}
          getKey={(item) => item.id}
          // "Other" is always offered, last; active products before inactive ones.
          rank={(item, q) => {
            if (isOther(item)) return 1;
            const score = rankText(q, item.code, item.name, item.companyName);
            return score ? score + (item.active ? 2 : 1) : 0;
          }}
          render={(item) =>
            isOther(item) ? (
              <span className="font-medium">Other (not in the list)…</span>
            ) : (
              <span>
                <span className="font-medium">
                  {item.code} {item.name}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {item.companyName}
                  {item.active ? "" : " · inactive"}
                </span>
              </span>
            )
          }
          onSelect={(item) =>
            isOther(item)
              ? addOther()
              : add({
                  productId: item.id,
                  companyId: item.companyId,
                  description: "",
                  qty: "",
                  rate: lastRates[item.id] ?? item.rate,
                  damaged: false,
                })
          }
          placeholder="Code or name, or Other"
          limit={10}
        />
      </div>
    </section>
  );
}
