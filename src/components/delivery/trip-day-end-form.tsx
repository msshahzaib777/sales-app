"use client";

import Decimal from "decimal.js";
import { useActionState, useRef, useState } from "react";

import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";
import { deliveredLines } from "@/lib/delivery";
import { formatMoney } from "@/lib/format";
import { minimumPayment } from "@/lib/sales";
import { formatDozens, parseQuantity, quantityText } from "@/lib/units";
import { cn } from "@/lib/utils";

import type { DayEndLine } from "./day-end-form";

export type TripDayEndOrder = {
  id: string;
  number: number;
  customer: string;
  detail: string;
  phone: string | null;
  previous: string;
  billBefore: string;
  creditLimit: string | null;
  lines: DayEndLine[];
};

type Entry = {
  qty: Record<string, { returned: string; damaged: string }>;
  cash: string;
  online: string;
  onlineReference: string;
  cheque: string;
  chequeNo: string;
  bankName: string;
  chequeDate: string;
  note: string;
};

/** A quantity as typed; blank → 0; unreadable → null. */
const packets = (text: string) => (text.trim() === "" ? 0 : parseQuantity(text));
const money = (v: string) =>
  /^\d+(\.\d{1,2})?$/.test(v.trim().replace(/,/g, ""))
    ? new Decimal(v.trim().replace(/,/g, ""))
    : new Decimal(0);

/** Bill after returns, total due, collected and the minimum payment for one order, as typed. */
function figures(o: TripDayEndOrder, e: Entry) {
  const results = o.lines.map((l) => {
    const q = e.qty[l.productId] ?? { returned: "", damaged: "" };
    return { productId: l.productId, returned: packets(q.returned), damaged: packets(q.damaged) };
  });
  const bad = results.map(
    (r, i) =>
      r.returned === null || r.damaged === null || r.returned + r.damaged > o.lines[i]!.quantity,
  );
  const kept = bad.some(Boolean)
    ? null
    : deliveredLines(
        o.lines,
        results.map((r) => ({
          productId: r.productId,
          returned: r.returned!,
          damaged: r.damaged!,
        })),
      );
  const billAfter = kept ? kept.reduce((s, l) => s.add(l.netAmount), new Decimal(0)) : null;
  const collected = money(e.cash).add(money(e.online)).add(money(e.cheque));
  const due = billAfter ? billAfter.add(o.previous) : null;
  const minimum = due
    ? minimumPayment({ previous: o.previous, totalDue: due, creditLimit: o.creditLimit })
    : null;
  return {
    results,
    bad,
    billAfter,
    collected,
    due,
    short: minimum ? minimum.sub(collected) : null,
  };
}

/**
 * Day-end for a whole trip on one page, phone-first: one card per order (returns, damage, money),
 * running totals of what the driver should hand over, one Save. Enter: next box; Ctrl+Enter: save.
 */
export function TripDayEndForm({
  action,
  orders,
  tripDate,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  orders: TripDayEndOrder[];
  tripDate: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  // One request id per order for the life of this page, added when saving: pressing Save again
  // never posts an order twice (CLAUDE.md rule 7).
  const requestIds = useRef(new Map<string, string>());
  const submit = (formData: FormData) => {
    for (const o of orders) {
      if (!requestIds.current.has(o.id)) requestIds.current.set(o.id, crypto.randomUUID());
      formData.set(`o:${o.id}:requestId`, requestIds.current.get(o.id)!);
    }
    formAction(formData);
  };
  const blank = (): Entry => ({
    qty: {},
    cash: "",
    online: "",
    onlineReference: "",
    cheque: "",
    chequeNo: "",
    bankName: "",
    chequeDate: tripDate,
    note: "",
  });
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(orders.map((o) => [o.id, blank()])),
  );
  const update = (id: string, change: (e: Entry) => Entry) =>
    setEntries((all) => ({ ...all, [id]: change(all[id] ?? blank()) }));

  const all = orders.map((o) => ({ o, e: entries[o.id] ?? blank() }));
  const totals = all.reduce(
    (t, { e }) => ({
      cash: t.cash.add(money(e.cash)),
      cheque: t.cheque.add(money(e.cheque)),
      online: t.online.add(money(e.online)),
    }),
    { cash: new Decimal(0), cheque: new Decimal(0), online: new Decimal(0) },
  );
  const anyBad = all.some(({ o, e }) => figures(o, e).bad.some(Boolean));

  const onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.tagName === "TEXTAREA") return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      formRef.current?.requestSubmit();
      return;
    }
    const fields = [
      ...(formRef.current?.querySelectorAll<HTMLElement>("input:not([type=hidden])") ?? []),
    ];
    fields[fields.indexOf(target) + 1]?.focus();
  };

  return (
    <form ref={formRef} action={submit} onKeyDown={onKeyDown} className="space-y-4 pb-28">
      <p className="text-muted-foreground text-sm">
        Leave a product blank when all of it was delivered. Quantities in dozens (2, 2.5) or with
        packets (2dz 5pk, 5pk).
      </p>
      {all.map(({ o, e }, index) => (
        <OrderCard
          key={o.id}
          order={o}
          entry={e}
          index={index}
          state={state}
          onChange={(change) => update(o.id, change)}
        />
      ))}

      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur md:right-6 md:bottom-4 md:left-auto md:rounded-lg md:border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <dl className="grid grid-cols-[auto_auto] gap-x-3 text-sm sm:flex sm:gap-x-5">
            <dt className="text-muted-foreground">Cash</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(totals.cash.toFixed(2))}</dd>
            <dt className="text-muted-foreground">Cheques</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(totals.cheque.toFixed(2))}</dd>
            <dt className="text-muted-foreground">Online</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(totals.online.toFixed(2))}</dd>
          </dl>
          <Button
            type="submit"
            size="lg"
            disabled={pending || anyBad}
            className="h-12 min-w-40 text-base"
          >
            {pending ? "Saving…" : `Save all ${orders.length}`}
          </Button>
        </div>
        {anyBad ? (
          <p className="text-destructive mx-auto mt-1 max-w-5xl text-xs" role="status">
            A quantity can&apos;t be read or is more than was sent: check the boxes marked red.
          </p>
        ) : null}
        <div className="mx-auto max-w-5xl">
          <FormMessage state={state} />
        </div>
      </div>
    </form>
  );
}

function OrderCard({
  order: o,
  entry: e,
  index,
  state,
  onChange,
}: {
  order: TripDayEndOrder;
  entry: Entry;
  index: number;
  state: ActionState;
  onChange: (change: (e: Entry) => Entry) => void;
}) {
  const f = figures(o, e);
  const name = (field: string) => `o:${o.id}:${field}`;
  const err = (field: string) => fieldError(state, name(field));
  const setQty = (productId: string, field: "returned" | "damaged", value: string) =>
    onChange((x) => ({
      ...x,
      qty: {
        ...x.qty,
        [productId]: { ...(x.qty[productId] ?? { returned: "", damaged: "" }), [field]: value },
      },
    }));
  const money = (field: "cash" | "online" | "cheque", label: string, formName: string) => (
    <Box
      id={`${o.id}-${field}`}
      name={name(formName)}
      label={label}
      inputMode="decimal"
      value={e[field]}
      error={err(formName)}
      onChange={(v) => onChange((x) => ({ ...x, [field]: v }))}
    />
  );
  return (
    <fieldset
      className={cn("space-y-3 rounded-lg border p-3 sm:p-4", err("form") && "border-destructive")}
      aria-labelledby={`${o.id}-title`}
    >
      <input type="hidden" name="orderId" value={o.id} />

      <input type="hidden" name={name("label")} value={`#${o.number} ${o.customer}`} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${o.id}-title`} className="text-base font-semibold">
            {index + 1}. {o.customer}
            <span className="text-muted-foreground font-normal"> · #{o.number}</span>
          </h2>
          <p className="text-muted-foreground text-sm">
            {o.detail}
            {o.phone ? (
              <>
                {" · "}
                <a href={`tel:${o.phone}`} className="underline underline-offset-2">
                  {o.phone}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange((x) => ({
                ...x,
                qty: Object.fromEntries(
                  o.lines.map((l) => [
                    l.productId,
                    { returned: quantityText(l.quantity), damaged: "" },
                  ]),
                ),
              }))
            }
          >
            Refused all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange((x) => ({ ...x, qty: {} }))}
          >
            All delivered
          </Button>
        </div>
      </div>
      {err("form") ? (
        <p className="text-destructive text-sm" role="alert">
          {err("form")}
        </p>
      ) : null}

      <ul className="divide-y rounded-md border">
        {o.lines.map((l, i) => {
          const q = e.qty[l.productId] ?? { returned: "", damaged: "" };
          const r = f.results[i]!;
          const bad = f.bad[i];
          return (
            <li
              key={l.productId}
              className="grid gap-2 p-2 sm:grid-cols-[1fr_8rem_8rem_6rem] sm:items-center"
            >
              <input type="hidden" name={name("line.productId")} value={l.productId} />
              <div>
                <p className="text-sm font-medium">
                  {l.code} {l.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  Sent {formatDozens(l.quantity)} · {l.companyName}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:contents">
                <Qty
                  id={`${o.id}-${l.productId}-r`}
                  name={name("line.returned")}
                  label="Returned"
                  value={q.returned}
                  parsed={r.returned}
                  bad={bad}
                  error={err(`lines.${i}.returned`)}
                  onChange={(v) => setQty(l.productId, "returned", v)}
                />
                <Qty
                  id={`${o.id}-${l.productId}-d`}
                  name={name("line.damaged")}
                  label="Damaged"
                  value={q.damaged}
                  parsed={r.damaged}
                  bad={bad}
                  error={err(`lines.${i}.damaged`)}
                  onChange={(v) => setQty(l.productId, "damaged", v)}
                />
              </div>
              <p className="text-right text-sm tabular-nums">
                {bad ? (
                  <span className="text-destructive">check</span>
                ) : (
                  <>
                    <span className="text-muted-foreground sm:hidden">Delivered </span>
                    {formatDozens(l.quantity - r.returned! - r.damaged!)}
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {money("cash", "Cash", "cash")}
        {money("online", "Online", "onlineAmount")}
        {money("cheque", "Cheque", "chequeAmount")}
        <Box
          id={`${o.id}-note`}
          name={name("note")}
          label="Note"
          value={e.note}
          error={err("note")}
          onChange={(v) => onChange((x) => ({ ...x, note: v }))}
        />
        {e.online.trim() ? (
          <Box
            id={`${o.id}-ref`}
            name={name("onlineReference")}
            label="Online reference"
            value={e.onlineReference}
            error={err("onlineReference")}
            onChange={(v) => onChange((x) => ({ ...x, onlineReference: v }))}
          />
        ) : null}
        {e.cheque.trim() ? (
          <>
            <Box
              id={`${o.id}-cno`}
              name={name("chequeNo")}
              label="Cheque no."
              value={e.chequeNo}
              error={err("chequeNo")}
              onChange={(v) => onChange((x) => ({ ...x, chequeNo: v }))}
            />
            <Box
              id={`${o.id}-bank`}
              name={name("bankName")}
              label="Bank"
              value={e.bankName}
              error={err("bankName")}
              onChange={(v) => onChange((x) => ({ ...x, bankName: v }))}
            />
            <Box
              id={`${o.id}-cdate`}
              name={name("chequeDate")}
              label="Cheque date"
              type="date"
              value={e.chequeDate}
              error={err("chequeDate")}
              onChange={(v) => onChange((x) => ({ ...x, chequeDate: v }))}
            />
          </>
        ) : null}
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-live="polite">
        <span>
          Bill{" "}
          <strong className="tabular-nums">
            {f.billAfter ? formatMoney(f.billAfter.toFixed(2)) : "—"}
          </strong>
          {f.billAfter && !f.billAfter.eq(o.billBefore) ? (
            <span className="text-muted-foreground"> (was {formatMoney(o.billBefore)})</span>
          ) : null}
        </span>
        <span>
          Owed before <span className="tabular-nums">{formatMoney(o.previous)}</span>
        </span>
        <span>
          Collected <strong className="tabular-nums">{formatMoney(f.collected.toFixed(2))}</strong>
        </span>
        <span>
          Still owes{" "}
          <strong className="tabular-nums">
            {f.due ? formatMoney(f.due.sub(f.collected).toFixed(2)) : "—"}
          </strong>
        </span>
        {f.short?.gt(0) ? (
          <span className="text-destructive">
            {formatMoney(f.short.toFixed(2))} short of the minimum payment
          </span>
        ) : null}
      </p>
    </fieldset>
  );
}

function Qty({
  id,
  name,
  label,
  value,
  parsed,
  bad,
  error,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  parsed: number | null;
  bad: boolean;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground text-xs sm:sr-only">
        {label}
      </label>
      <Input
        id={id}
        name={name}
        value={value}
        placeholder={label}
        autoComplete="off"
        aria-invalid={bad || error ? true : undefined}
        className="h-11 text-base sm:h-9 sm:text-sm"
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : parsed ? (
        <p className="text-muted-foreground text-xs tabular-nums">= {formatDozens(parsed)}</p>
      ) : null}
    </div>
  );
}

function Box({
  id,
  name,
  label,
  value,
  error,
  type = "text",
  inputMode,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  error?: string;
  type?: string;
  inputMode?: "decimal";
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        aria-invalid={error ? true : undefined}
        className="h-11 text-base sm:h-9 sm:text-sm"
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
