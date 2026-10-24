"use client";

import Decimal from "decimal.js";
import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FieldError, FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Combobox, rankText } from "@/components/sales/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";
import { allocateOldestFirst, OLD_BALANCE } from "@/lib/payments";
import type { PaymentContext } from "@/server/services/payments/customer-payments";

type Customer = {
  id: string;
  name: string;
  shopName: string | null;
  phone: string | null;
  area: { name: string } | null;
};

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "ONLINE", label: "Online transfer" },
];

const amountOf = (v: string) =>
  /^\d+(\.\d{1,2})?$/.test(v.trim().replace(/,/g, ""))
    ? new Decimal(v.trim().replace(/,/g, ""))
    : null;

/**
 * Payment received at the office. Pick the customer to see what they owe per company and per bill;
 * "Oldest debt first" previews exactly how the server will apply the amount, "Split by company"
 * takes an amount per company.
 */
export function CustomerPaymentForm({
  action,
  loadContext,
  customers,
  initialCustomerId,
  today,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  loadContext: (customerId: string) => Promise<PaymentContext | { error: string }>;
  customers: Customer[];
  initialCustomerId?: string;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [context, setContext] = useState<PaymentContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [method, setMethod] = useState("CASH");
  const [mode, setMode] = useState<"auto" | "company">("auto");
  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!customerId) return;
    startLoading(async () => {
      const result = await loadContext(customerId);
      if ("error" in result) {
        setLoadError(result.error);
        setContext(null);
      } else {
        setLoadError(null);
        setContext(result);
      }
    });
  }, [customerId, loadContext]);

  const value = amountOf(amount);
  const debt = context
    ? {
        unbilled: new Map(context.unbilled.map(([k, v]) => [k, new Decimal(v)])),
        bills: context.bills.map((b) => ({
          ...b,
          slices: b.slices.map((s) => ({ companyId: s.companyId, outstanding: s.outstanding })),
        })),
      }
    : null;
  const preview =
    value && debt && mode === "auto" ? allocateOldestFirst(value, debt, context!.advanceTo) : null;
  const applied = (billId: string, companyId: string) =>
    preview?.allocations.find((a) => a.billId === billId && a.companyId === companyId)?.amount;
  const companyName = new Map([
    [OLD_BALANCE, "Old balance"],
    ...(context?.companies.map((c) => [c.id, c.name] as const) ?? []),
  ]);
  const splitTotal = Object.values(split).reduce((s, v) => s.add(amountOf(v) ?? 0), new Decimal(0));
  const owing = [
    ...(context && context.oldBalance !== "0.00"
      ? [{ name: "Old balance", owed: context.oldBalance }]
      : []),
    ...(context?.companies.filter((c) => c.owed !== "0.00") ?? []),
  ];

  return (
    <form action={(fd) => formAction(withRequestId(fd))} className="max-w-5xl space-y-6">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="space-y-2">
        {context ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-lg font-medium">
              {context.customer.name}
              {context.customer.shopName ? (
                <span className="text-muted-foreground"> · {context.customer.shopName}</span>
              ) : null}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCustomerId("");
                setContext(null);
                setSplit({});
              }}
            >
              Change customer
            </Button>
          </div>
        ) : (
          <Combobox
            label="Customer"
            items={customers}
            getKey={(c) => c.id}
            autoFocus
            rank={(c, q) => rankText(q, null, c.name, c.shopName, c.phone, c.area?.name)}
            render={(c) => (
              <span>
                <span className="font-medium">{c.name}</span>
                {c.shopName ? ` · ${c.shopName}` : ""}
                <span className="text-muted-foreground">
                  {c.area ? ` · ${c.area.name}` : ""}
                  {c.phone ? ` · ${c.phone}` : ""}
                </span>
              </span>
            )}
            onSelect={(c) => setCustomerId(c.id)}
            placeholder="Name, shop, phone or area"
          />
        )}
        <FieldError
          id="customer-error"
          message={fieldError(state, "customerId") ?? loadError ?? undefined}
        />
        {loading ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
        {context?.customer.isFlagged ? (
          <p
            role="alert"
            className="border-destructive text-destructive rounded-md border px-3 py-2 text-sm"
          >
            Flagged: {context.customer.flagReason ?? "check with the owner"}
          </p>
        ) : null}
      </div>

      {context ? (
        <>
          <div className="text-sm">
            Owes now <strong className="tabular-nums">{formatMoney(context.pending)}</strong>
            {owing.length > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                ({owing.map((c) => `${c.name} ${formatMoney(c.owed)}`).join(" · ")})
              </span>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <label htmlFor="field-amount" className="text-sm font-medium">
                Amount (PKR) <span className="text-muted-foreground">*</span>
              </label>
              <Input
                id="field-amount"
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={fieldError(state, "amount") ? true : undefined}
              />
              <FieldError id="field-amount-error" message={fieldError(state, "amount")} />
            </div>
            <TextField
              state={state}
              name="paymentDate"
              label="Payment date"
              type="date"
              required
              defaultValue={today}
            />
            <div
              onChange={(e) => {
                const t = e.target;
                if (t instanceof HTMLSelectElement) setMethod(t.value);
              }}
            >
              <SelectField
                state={state}
                name="method"
                label="Method"
                required
                options={METHODS}
                defaultValue="CASH"
              />
            </div>
            {method === "CHEQUE" ? (
              <>
                <TextField
                  state={state}
                  name="chequeNo"
                  label="Cheque no."
                  required
                  maxLength={30}
                />
                <TextField state={state} name="bankName" label="Bank" required maxLength={60} />
                <TextField
                  state={state}
                  name="chequeDate"
                  label="Cheque date"
                  type="date"
                  required
                  defaultValue={today}
                />
              </>
            ) : (
              <TextField
                state={state}
                name="reference"
                label={method === "ONLINE" ? "Transfer reference" : "Reference"}
                maxLength={80}
              />
            )}
            <TextField
              state={state}
              name="note"
              label="Note"
              maxLength={500}
              className="sm:col-span-4"
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="font-medium">Apply to</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="allocationMode"
                  value="auto"
                  checked={mode === "auto"}
                  onChange={() => setMode("auto")}
                />
                Oldest debt first
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="allocationMode"
                  value="company"
                  checked={mode === "company"}
                  onChange={() => setMode("company")}
                />
                Split by company
              </label>
            </div>

            {mode === "auto" ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Owed for</th>
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 text-right font-medium">Unpaid</th>
                      <th className="px-3 py-2 text-right font-medium">This payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {context.unbilled.length === 0 && context.bills.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-muted-foreground px-3 py-3 text-center">
                          Nothing owed. The payment is kept as an advance.
                        </td>
                      </tr>
                    ) : null}
                    {context.unbilled.map(([companyId, owed]) => (
                      <tr key={`u-${companyId}`} className="border-t">
                        <td className="px-3 py-1.5">
                          {companyId === OLD_BALANCE ? "Old balance" : "Opening balance"}
                        </td>
                        <td className="px-3 py-1.5">
                          {companyId === OLD_BALANCE ? "—" : companyName.get(companyId)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(owed)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {preview && value
                            ? formatMoney(
                                Decimal.min(
                                  new Decimal(owed),
                                  // share of the opening part (opening balances are paid first)
                                  (preview.byCompany.get(companyId) ?? new Decimal(0)).sub(
                                    preview.allocations
                                      .filter((a) => a.companyId === companyId)
                                      .reduce((s, a) => s.add(a.amount), new Decimal(0)),
                                  ),
                                ).toFixed(2),
                              )
                            : ""}
                        </td>
                      </tr>
                    ))}
                    {context.bills.flatMap((b) =>
                      b.slices.map((s, i) => (
                        <tr key={`${b.billId}-${s.companyId}`} className="border-t">
                          <td className="px-3 py-1.5">
                            {i === 0 ? `Bill #${b.number} · ${b.billDate}` : ""}
                          </td>
                          <td className="px-3 py-1.5">{s.companyName}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {formatMoney(s.outstanding)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {applied(b.billId, s.companyId)
                              ? formatMoney(applied(b.billId, s.companyId)!.toFixed(2))
                              : ""}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {context.oldBalance !== "0.00" ? (
                  <div className="space-y-1">
                    <label htmlFor="company-old" className="text-sm font-medium">
                      Old balance{" "}
                      <span className="text-muted-foreground font-normal">
                        owes {formatMoney(context.oldBalance)}
                      </span>
                    </label>
                    <Input
                      id="company-old"
                      name={`company:${OLD_BALANCE}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={split[OLD_BALANCE] ?? ""}
                      onChange={(e) => setSplit((s) => ({ ...s, [OLD_BALANCE]: e.target.value }))}
                    />
                  </div>
                ) : null}
                {context.companies.map((c) => (
                  <div key={c.id} className="space-y-1">
                    <label htmlFor={`company-${c.id}`} className="text-sm font-medium">
                      {c.name}{" "}
                      <span className="text-muted-foreground font-normal">
                        owes {formatMoney(c.owed)}
                      </span>
                    </label>
                    <Input
                      id={`company-${c.id}`}
                      name={`company:${c.id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={split[c.id] ?? ""}
                      onChange={(e) => setSplit((s) => ({ ...s, [c.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}
            <p className="text-sm" aria-live="polite">
              {mode === "auto" && preview ? (
                <>
                  Applied {formatMoney(new Decimal(value!).sub(preview.advance).toFixed(2))}
                  {preview.advance.gt(0) ? (
                    <>
                      {" "}
                      · advance <strong>{formatMoney(preview.advance.toFixed(2))}</strong>
                      {context.advanceTo.length === 0 ? (
                        <span className="text-destructive">
                          {" "}
                          · choose &ldquo;Split by company&rdquo; for an advance
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {preview.byCompany.size > 0 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · by company:{" "}
                      {[...preview.byCompany]
                        .map(([k, v]) => `${companyName.get(k)} ${formatMoney(v.toFixed(2))}`)
                        .join(", ")}
                    </span>
                  ) : null}
                </>
              ) : null}
              {mode === "company" ? (
                <>
                  Split total {formatMoney(splitTotal.toFixed(2))}
                  {value && !splitTotal.eq(value) ? (
                    <strong className="text-destructive">
                      {" "}
                      · must equal the payment ({formatMoney(value.toFixed(2))})
                    </strong>
                  ) : null}
                </>
              ) : null}
            </p>
          </fieldset>

          <FormMessage state={state} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Posting…" : "Post payment"}
            </Button>
            <Button type="submit" name="intent" value="next" variant="secondary" disabled={pending}>
              Post and receive next
            </Button>
            <Button asChild variant="ghost">
              <Link href="/payments">Cancel</Link>
            </Button>
          </div>
        </>
      ) : null}
    </form>
  );
}
