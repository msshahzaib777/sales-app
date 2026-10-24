"use client";

import { useActionState, useRef, useState } from "react";

import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ActionState, idleState } from "@/lib/action-state";
import { formatDozens, quantityText } from "@/lib/units";

type Row = {
  id: string;
  code: string;
  name: string;
  companyName: string;
  warehouseName: string;
  /** Packets. */
  opening: number;
  onHand: number;
};

const asDozens = (packets: number) => quantityText(packets);

/**
 * The stock already in the warehouse on the first day, product by product, in dozens.
 * Keyboard-first: Enter goes to the next product, Ctrl+Enter saves. Only changed rows are sent.
 */
export function OpeningStockForm({
  action,
  rows,
  today,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  rows: Row[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.opening ? asDozens(r.opening) : ""])),
  );
  const changed = rows.filter(
    (r) => (values[r.id] ?? "") !== (r.opening ? asDozens(r.opening) : ""),
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName === "BUTTON") return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return formRef.current?.requestSubmit();
    const inputs = [
      ...(formRef.current?.querySelectorAll<HTMLInputElement>("input[data-qty]") ?? []),
    ];
    inputs[inputs.indexOf(target as HTMLInputElement) + 1]?.focus();
  };

  return (
    <form
      ref={formRef}
      onKeyDown={onKeyDown}
      action={(fd) => {
        // Send only the rows that changed.
        const out = new FormData();
        out.set("stockDate", String(fd.get("stockDate") ?? ""));
        for (const r of changed) {
          out.append("productId", r.id);
          out.append("quantity", values[r.id] === "" ? "0" : values[r.id]!);
        }
        formAction(withRequestId(out));
      }}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="stockDate">Stock counted on</Label>
          <Input
            id="stockDate"
            name="stockDate"
            type="date"
            defaultValue={today}
            className="w-44"
          />
        </div>
        <p className="text-muted-foreground text-sm">
          Type what is in the warehouse now, in dozens (3.5 = 3½ dozen). Leave blank for none.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 text-right font-medium">On hand now</th>
              <th className="px-3 py-2 font-medium">Opening stock (dz)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-3 py-6 text-center">
                  No products. Add products first.
                </td>
              </tr>
            ) : null}
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-1.5 font-mono">{r.code}</td>
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5">
                  {r.companyName}
                  <div className="text-muted-foreground text-xs">{r.warehouseName}</div>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatDozens(r.onHand)}</td>
                <td className="px-3 py-1.5">
                  <Input
                    data-qty
                    inputMode="decimal"
                    autoComplete="off"
                    autoFocus={i === 0}
                    className="w-28"
                    aria-label={`Opening stock of ${r.name}, dozens`}
                    value={values[r.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || changed.length === 0}>
          {pending
            ? "Saving…"
            : `Save opening stock${changed.length ? ` (${changed.length})` : ""}`}
        </Button>
        <span className="text-muted-foreground text-xs">
          Enter: next product · Ctrl+Enter: save
        </span>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
