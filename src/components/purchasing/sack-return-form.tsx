"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";

export function SackReturnForm({
  action,
  companies,
  defaultCompanyId,
  today,
  showRate,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  companies: { id: string; name: string; sackRate: string | null; withUs: number | null }[];
  defaultCompanyId?: string;
  today: string;
  showRate: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const [companyId, setCompanyId] = useState(
    defaultCompanyId ?? companies.find((c) => c.sackRate)?.id ?? companies[0]?.id ?? "",
  );
  const [sacks, setSacks] = useState("");
  const company = companies.find((c) => c.id === companyId);
  const count = Number(sacks);
  const credit =
    company?.sackRate && Number.isInteger(count) && count > 0
      ? Number(company.sackRate) * count
      : null;

  return (
    <form
      action={(fd) => formAction(withRequestId(fd))}
      className="max-w-3xl space-y-6"
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLSelectElement && t.name === "companyId") setCompanyId(t.value);
        if (t instanceof HTMLInputElement && t.name === "sacks") setSacks(t.value);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <SelectField
          state={state}
          name="companyId"
          label="Company"
          required
          options={companies.map((c) => ({
            value: c.id,
            label: c.sackRate ? `${c.name} · ${formatMoney(c.sackRate)} a sack` : c.name,
          }))}
          defaultValue={companyId}
          className="sm:col-span-2"
        />
        <TextField
          state={state}
          name="returnDate"
          label="Returned on"
          type="date"
          required
          defaultValue={today}
        />
        <TextField
          state={state}
          name="sacks"
          label="Sacks returned"
          inputMode="numeric"
          required
          autoFocus
          hint={
            company?.withUs != null && company.withUs > 0
              ? `${company.withUs} with you from goods received`
              : undefined
          }
        />
        {showRate ? (
          <TextField
            state={state}
            name="rate"
            label="Price per sack"
            inputMode="decimal"
            hint={company?.sackRate ? `Blank = ${formatMoney(company.sackRate)}` : "Required"}
          />
        ) : null}
        <TextField
          state={state}
          name="note"
          label="Note"
          maxLength={500}
          className={showRate ? "sm:col-span-3" : "sm:col-span-4"}
        />
      </div>
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {credit !== null ? (
          <>
            Credit: <span className="text-foreground font-medium">{formatMoney(credit)}</span>.{" "}
          </>
        ) : null}
        It reduces what you owe the company now and is deducted on its next bill.
        {company && !company.sackRate
          ? " This company has no sack price yet: set it on the company, or type the price."
          : null}
      </p>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save sack return"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/purchases/claims">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
