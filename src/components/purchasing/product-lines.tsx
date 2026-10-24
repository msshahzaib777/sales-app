"use client";

import { useState } from "react";

import { FieldError } from "@/components/form/form-message";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { Input } from "@/components/ui/input";
import { formatDozens, PACKETS_PER_DOZEN, parseQuantity } from "@/lib/units";
import { type ActionState, fieldError } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";

export type LineProduct = { id: string; code: string; name: string; purchaseRate: string | null };
export type LineDefaults = Record<
  string,
  { quantity?: string; rate?: string; ordered?: string; remaining?: string }
>;

/**
 * One row per product of the company: type a quantity (dozens) for what is ordered or received,
 * leave the rest blank. Tab moves down the quantity column; Enter saves the form.
 */
export function ProductLines({
  products,
  defaults,
  showRate,
  showOrdered,
  state,
}: {
  products: LineProduct[];
  defaults: LineDefaults;
  showRate: boolean;
  showOrdered: boolean;
  state: ActionState;
}) {
  const echoed = (field: string, i: number) =>
    state.status === "error" ? state.values?.[`${field}.${i}`] : undefined;
  const initial = Object.fromEntries(
    products.map((p, i) => [
      p.id,
      {
        qty: echoed("quantity", i) ?? defaults[p.id]?.quantity ?? "",
        rate: echoed("rate", i) ?? defaults[p.id]?.rate ?? p.purchaseRate ?? "",
      },
    ]),
  );
  const [values, setValues] = useState(initial);
  // Quantities as typed ("12", "12.5", "12dz 6pk") in packets; rates are per dozen.
  const packets = (id: string) => parseQuantity(values[id]?.qty ?? "") ?? 0;
  const amount = (id: string) => {
    const r = Number((values[id]?.rate ?? "").replace(/,/g, ""));
    return Number.isFinite(r) ? (packets(id) / PACKETS_PER_DOZEN) * r : 0;
  };
  const total = products.reduce((s, p) => s + amount(p.id), 0);
  const totalPackets = products.reduce((s, p) => s + packets(p.id), 0);

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Code</Th>
          <Th>Product</Th>
          {showOrdered ? <Th className="text-right">Ordered</Th> : null}
          {showOrdered ? <Th className="text-right">Still due</Th> : null}
          <Th className="w-32">Quantity (dz)</Th>
          {showRate ? <Th className="w-36">Rate / dz</Th> : null}
          {showRate ? <Th className="text-right">Amount</Th> : null}
        </tr>
      </thead>
      <tbody>
        {products.length === 0 ? (
          <EmptyRow colSpan={7}>This company has no active products.</EmptyRow>
        ) : null}
        {products.map((p) => {
          const qtyError = fieldError(state, `quantity.${p.id}`);
          const rateError = fieldError(state, `rate.${p.id}`);
          return (
            <tr key={p.id}>
              <Td className="font-mono">{p.code}</Td>
              <Td>
                <label htmlFor={`qty-${p.id}`}>{p.name}</label>
                <input type="hidden" name="productId" value={p.id} />
              </Td>
              {showOrdered ? (
                <Td className="text-right tabular-nums">{defaults[p.id]?.ordered ?? "—"}</Td>
              ) : null}
              {showOrdered ? (
                <Td className="text-right tabular-nums">{defaults[p.id]?.remaining ?? "—"}</Td>
              ) : null}
              <Td>
                <Input
                  id={`qty-${p.id}`}
                  name="quantity"
                  inputMode="decimal"
                  autoComplete="off"
                  value={values[p.id]?.qty ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [p.id]: { ...v[p.id]!, qty: e.target.value } }))
                  }
                  aria-invalid={qtyError ? true : undefined}
                  aria-describedby={qtyError ? `qty-${p.id}-error` : undefined}
                  className="h-8"
                />
                <FieldError id={`qty-${p.id}-error`} message={qtyError} />
              </Td>
              {showRate ? (
                <Td>
                  <Input
                    name="rate"
                    aria-label={`Rate for ${p.name}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={values[p.id]?.rate ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [p.id]: { ...v[p.id]!, rate: e.target.value } }))
                    }
                    aria-invalid={rateError ? true : undefined}
                    className="h-8"
                  />
                  <FieldError id={`rate-${p.id}-error`} message={rateError} />
                </Td>
              ) : (
                <input type="hidden" name="rate" value="" />
              )}
              {showRate ? (
                <Td className="text-right tabular-nums">
                  {amount(p.id) ? formatMoney(amount(p.id).toFixed(2)) : ""}
                </Td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="font-medium">
          <Td>Total</Td>
          <Td />
          {showOrdered ? <Td /> : null}
          {showOrdered ? <Td /> : null}
          <Td className="tabular-nums">{totalPackets ? formatDozens(totalPackets) : ""}</Td>
          {showRate ? <Td /> : null}
          {showRate ? (
            <Td className="text-right tabular-nums">
              {total ? formatMoney(total.toFixed(2)) : ""}
            </Td>
          ) : null}
        </tr>
      </tfoot>
    </DataTable>
  );
}
