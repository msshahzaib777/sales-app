"use client";

import Decimal from "decimal.js";
import { useActionState, useRef, useState } from "react";

import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ActionState, fieldError, idleState, submittedValue } from "@/lib/action-state";
import { deliveredLines, type BookedLine } from "@/lib/delivery";
import { formatMoney } from "@/lib/format";
import { minimumPayment } from "@/lib/sales";
import { formatDozens, parseQuantity, quantityText } from "@/lib/units";

export type DayEndLine = BookedLine & { code: string; name: string; companyName: string };

/** A quantity as typed ("2", "2dz 5pk", "5pk") in packets; blank → 0; unreadable → null. */
function packets(text: string): number | null {
  return text.trim() === "" ? 0 : parseQuantity(text);
}

/** "= 2 dz 5 pk" under a box, so the entry can be checked against the bill. */
function PacketsHint({ value }: { value: number | null }) {
  return value ? (
    <div className="text-muted-foreground mt-0.5 text-xs tabular-nums">= {formatDozens(value)}</div>
  ) : null;
}

/**
 * One order's day-end entry, keyboard-first: Enter moves to the next box, Ctrl+Enter saves. The bill
 * after returns and damage and the total due update while typing.
 */
export function DayEndForm({
  action,
  orderId,
  tripDate,
  lines,
  previous,
  billBefore,
  creditLimit,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  orderId: string;
  tripDate: string;
  lines: DayEndLine[];
  previous: string;
  billBefore: string;
  creditLimit: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const formRef = useRef<HTMLFormElement>(null);
  const [qty, setQty] = useState<Record<string, { returned: string; damaged: string }>>({});
  const [paid, setPaid] = useState({ cash: "", cheque: "", online: "" });

  const results = lines.map((l) => {
    const q = qty[l.productId] ?? { returned: "", damaged: "" };
    return {
      productId: l.productId,
      returned: packets(q.returned),
      damaged: packets(q.damaged),
    };
  });
  const invalid = results.some(
    (r, i) =>
      r.returned === null || r.damaged === null || r.returned + r.damaged > lines[i]!.quantity,
  );
  const kept = invalid
    ? null
    : deliveredLines(
        lines,
        results.map((r) => ({
          productId: r.productId,
          returned: r.returned!,
          damaged: r.damaged!,
        })),
      );
  const billAfter = kept ? kept.reduce((s, l) => s.add(l.netAmount), new Decimal(0)) : null;
  const money = (v: string) =>
    /^\d+(\.\d{1,2})?$/.test(v.trim()) ? new Decimal(v.trim()) : new Decimal(0);
  const collected = money(paid.cash).add(money(paid.cheque)).add(money(paid.online));
  const due = billAfter ? billAfter.add(previous) : null;
  const minimum = due ? minimumPayment({ previous, totalDue: due, creditLimit }) : null;
  const short = minimum ? minimum.sub(collected) : null;

  const set = (productId: string, field: "returned" | "damaged", value: string) =>
    setQty((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] ?? { returned: "", damaged: "" }), [field]: value },
    }));

  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName === "BUTTON") return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      formRef.current?.requestSubmit();
      return;
    }
    const fields = [
      ...(formRef.current?.querySelectorAll<HTMLElement>("input:not([type=hidden])") ?? []),
    ];
    const next = fields[fields.indexOf(target) + 1];
    if (next) next.focus();
    else formRef.current?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
  };

  return (
    <form
      ref={formRef}
      action={(fd) => formAction(withRequestId(fd))}
      onKeyDown={onKeyDown}
      className="space-y-6"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <section aria-labelledby="lines-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lines-heading" className="font-medium">
            Products: returns and damage in dozens (2, 2.5) or with packets (2dz 5pk, 5pk); blank
            when all were delivered
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setQty(
                Object.fromEntries(
                  lines.map((l) => [
                    l.productId,
                    { returned: quantityText(l.quantity), damaged: "" },
                  ]),
                ),
              )
            }
          >
            Customer refused all
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 text-right font-medium">Sent</th>
                <th className="px-3 py-2 font-medium">Returned</th>
                <th className="px-3 py-2 font-medium">Damaged</th>
                <th className="px-3 py-2 text-right font-medium">Delivered</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const r = results[i]!;
                const bad =
                  r.returned === null || r.damaged === null || r.returned + r.damaged > l.quantity;
                const keptLine = kept?.find((k) => k.productId === l.productId);
                const q = qty[l.productId] ?? { returned: "", damaged: "" };
                return (
                  <tr key={l.productId} className="border-t">
                    <td className="px-3 py-1.5">
                      <input type="hidden" name="line.productId" value={l.productId} />
                      {l.code} {l.name}
                      <div className="text-muted-foreground text-xs">{l.companyName}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatDozens(l.quantity)}
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        name="line.returned"
                        autoComplete="off"
                        className="w-24"
                        placeholder="dz"
                        value={q.returned}
                        autoFocus={i === 0}
                        aria-label={`${l.name} returned`}
                        aria-invalid={bad ? true : undefined}
                        onChange={(e) => set(l.productId, "returned", e.target.value)}
                      />
                      <PacketsHint value={r.returned} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        name="line.damaged"
                        autoComplete="off"
                        className="w-24"
                        placeholder="dz"
                        value={q.damaged}
                        aria-label={`${l.name} damaged`}
                        aria-invalid={bad ? true : undefined}
                        onChange={(e) => set(l.productId, "damaged", e.target.value)}
                      />
                      <PacketsHint value={r.damaged} />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {bad ? (
                        <span className="text-destructive">check</span>
                      ) : (
                        formatDozens(l.quantity - r.returned! - r.damaged!)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {bad ? "—" : formatMoney(keptLine?.netAmount.toFixed(2) ?? "0")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">
          Returned goes back to stock. Damaged goes to damaged stock and is claimed from the
          company.
        </p>
      </section>

      <section aria-labelledby="money-heading" className="space-y-3">
        <h2 id="money-heading" className="font-medium">
          Collected by the driver
        </h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <MoneyField
            state={state}
            name="cash"
            label="Cash"
            value={paid.cash}
            onChange={(v) => setPaid({ ...paid, cash: v })}
          />
          <MoneyField
            state={state}
            name="onlineAmount"
            label="Online"
            value={paid.online}
            onChange={(v) => setPaid({ ...paid, online: v })}
          />
          <div className="sm:col-span-2">
            <Text state={state} name="onlineReference" label="Online reference" />
          </div>
          <MoneyField
            state={state}
            name="chequeAmount"
            label="Cheque"
            value={paid.cheque}
            onChange={(v) => setPaid({ ...paid, cheque: v })}
          />
          <Text state={state} name="chequeNo" label="Cheque no." />
          <Text state={state} name="bankName" label="Bank" />
          <Text
            state={state}
            name="chequeDate"
            label="Cheque date"
            type="date"
            defaultValue={tripDate}
          />
        </div>
        <Text state={state} name="note" label="Note" />
      </section>

      <dl className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border p-4 text-sm">
        <dt>Bill as sent</dt>
        <dd className="text-right tabular-nums">{formatMoney(billBefore)}</dd>
        <dt>Bill after returns and damage</dt>
        <dd className="text-right font-medium tabular-nums">
          {billAfter ? formatMoney(billAfter.toFixed(2)) : "—"}
        </dd>
        <dt>Previous pending</dt>
        <dd className="text-right tabular-nums">{formatMoney(previous)}</dd>
        <dt className="font-semibold">Total due</dt>
        <dd className="text-right font-semibold tabular-nums">
          {due ? formatMoney(due.toFixed(2)) : "—"}
        </dd>
        <dt>Minimum payment</dt>
        <dd className="text-right tabular-nums">
          {minimum ? formatMoney(minimum.toFixed(2)) : "—"}
        </dd>
        <dt>Collected</dt>
        <dd className="text-right tabular-nums">{formatMoney(collected.toFixed(2))}</dd>
        <dt className="border-t pt-1 font-semibold">Still pending</dt>
        <dd className="border-t pt-1 text-right font-semibold tabular-nums">
          {due ? formatMoney(due.sub(collected).toFixed(2)) : "—"}
        </dd>
        {short?.gt(0) ? (
          <dd className="text-destructive col-span-2 text-right text-xs" role="note">
            {formatMoney(short.toFixed(2))} short of the minimum payment
          </dd>
        ) : null}
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || invalid}>
          {pending ? "Saving…" : "Save day-end"}
        </Button>
        <span className="text-muted-foreground text-xs">Enter: next box · Ctrl+Enter: save</span>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function MoneyField({
  state,
  name,
  label,
  value,
  onChange,
}: {
  state: ActionState;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const error = fieldError(state, name);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error ? (
        <p id={`${name}-error`} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Text({
  state,
  name,
  label,
  type = "text",
  defaultValue,
}: {
  state: ActionState;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
}) {
  const error = fieldError(state, name);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete="off"
        maxLength={type === "date" ? undefined : 80}
        defaultValue={submittedValue(state, name) ?? defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error ? (
        <p id={`${name}-error`} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
