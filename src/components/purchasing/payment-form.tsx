"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FieldError, FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";

type Bill = {
  id: string;
  number: number;
  isOpening: boolean;
  billDate: string;
  dueDate: string;
  outstanding: string;
};

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "ONLINE", label: "Online transfer" },
];

const num = (v: string) => Number(v.replace(/,/g, "")) || 0;
const paisa = (v: number) => Math.round(v * 100) / 100;

/**
 * Company payment. "Oldest bills first" lets the server allocate; "Choose bills" shows an amount
 * box per open bill ("Fill oldest first" pre-fills them from the payment amount).
 */
export function CompanyPaymentForm({
  action,
  companies,
  billsByCompany,
  initialCompanyId,
  today,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  companies: { id: string; name: string }[];
  billsByCompany: Record<string, Bill[]>;
  initialCompanyId?: string;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const [companyId, setCompanyId] = useState(initialCompanyId ?? companies[0]?.id ?? "");
  const [method, setMethod] = useState("CASH");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [amount, setAmount] = useState("");
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const bills = [...(billsByCompany[companyId] ?? [])].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.number - b.number,
  );
  const totalOpen = bills.reduce((s, b) => s + num(b.outstanding), 0);
  const allocated =
    mode === "manual"
      ? Object.values(allocs).reduce((s, v) => s + num(v), 0)
      : Math.min(num(amount), totalOpen);
  const unallocated = paisa(num(amount) - allocated);

  const fillOldestFirst = () => {
    let left = num(amount);
    const next: Record<string, string> = {};
    for (const b of bills) {
      const take = paisa(Math.min(left, num(b.outstanding)));
      if (take > 0) next[b.id] = take.toFixed(2);
      left = paisa(left - take);
    }
    setAllocs(next);
  };

  return (
    <form
      action={(fd) => formAction(withRequestId(fd))}
      className="max-w-5xl space-y-6"
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLSelectElement && t.name === "companyId") {
          setCompanyId(t.value);
          setAllocs({});
        }
        if (t instanceof HTMLSelectElement && t.name === "method") setMethod(t.value);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <SelectField
          state={state}
          name="companyId"
          label="Company"
          required
          autoFocus
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
          defaultValue={companyId}
          className="sm:col-span-2"
        />
        <TextField
          state={state}
          name="paymentDate"
          label="Payment date"
          type="date"
          required
          defaultValue={today}
        />
        <div className="space-y-1.5">
          <label htmlFor="field-amount" className="text-sm font-medium">
            Amount (PKR) <span className="text-muted-foreground">*</span>
          </label>
          <Input
            id="field-amount"
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={fieldError(state, "amount") ? true : undefined}
          />
          <FieldError id="field-amount-error" message={fieldError(state, "amount")} />
        </div>
        <SelectField
          state={state}
          name="method"
          label="Method"
          required
          options={METHODS}
          defaultValue="CASH"
        />
        {method === "CHEQUE" ? (
          <>
            <TextField state={state} name="chequeNo" label="Cheque no." required maxLength={30} />
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
            className="sm:col-span-3"
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
        <legend className="font-medium">Apply to bills</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="allocationMode"
              value="auto"
              checked={mode === "auto"}
              onChange={() => setMode("auto")}
            />
            Oldest bills first
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="allocationMode"
              value="manual"
              checked={mode === "manual"}
              onChange={() => setMode("manual")}
            />
            Choose bills
          </label>
          {mode === "manual" ? (
            <Button type="button" variant="outline" size="sm" onClick={fillOldestFirst}>
              Fill oldest first
            </Button>
          ) : null}
        </div>
        <DataTable>
          <thead>
            <tr>
              <Th>Bill</Th>
              <Th>Bill date</Th>
              <Th>Due</Th>
              <Th className="text-right">Outstanding</Th>
              {mode === "manual" ? <Th className="w-40">Pay now</Th> : null}
            </tr>
          </thead>
          <tbody>
            {bills.length === 0 ? (
              <EmptyRow colSpan={5}>
                No open bills. The payment will be kept as an advance.
              </EmptyRow>
            ) : null}
            {bills.map((b) => (
              <tr key={b.id}>
                <Td>
                  #{b.number}
                  {b.isOpening ? (
                    <span className="text-muted-foreground"> Opening balance</span>
                  ) : null}
                </Td>
                <Td>{b.billDate}</Td>
                <Td>{b.dueDate}</Td>
                <Td className="text-right tabular-nums">{formatMoney(b.outstanding)}</Td>
                {mode === "manual" ? (
                  <Td>
                    <Input
                      name={`alloc:${b.id}`}
                      aria-label={`Pay now on bill ${b.number}`}
                      inputMode="decimal"
                      className="h-8"
                      value={allocs[b.id] ?? ""}
                      onChange={(e) => setAllocs((a) => ({ ...a, [b.id]: e.target.value }))}
                    />
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </DataTable>
        <p className="text-sm" aria-live="polite">
          Open bills: <strong>{formatMoney(totalOpen.toFixed(2))}</strong> · Applied:{" "}
          <strong>{formatMoney(allocated.toFixed(2))}</strong>
          {unallocated > 0 ? (
            <>
              {" "}
              · Kept as advance: <strong>{formatMoney(unallocated.toFixed(2))}</strong>
            </>
          ) : null}
          {unallocated < 0 ? (
            <strong className="text-destructive"> · Applied is more than the payment</strong>
          ) : null}
        </p>
      </fieldset>

      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Posting…" : "Post payment"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/purchases/payments">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
