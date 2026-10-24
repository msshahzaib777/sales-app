"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";

const TYPES = [
  { value: "DELIVERY_DAMAGE", label: "Damaged in delivery" },
  { value: "OTHER", label: "Other" },
];

export function ClaimForm({
  action,
  companies,
  products,
  today,
  showRate,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  companies: { id: string; name: string }[];
  products: {
    id: string;
    code: string;
    name: string;
    companyId: string;
    purchaseRate: string | null;
  }[];
  today: string;
  showRate: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const options = products
    .filter((p) => p.companyId === companyId)
    .map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));

  return (
    <form
      action={(fd) => formAction(withRequestId(fd))}
      className="max-w-3xl space-y-6"
      onChange={(e) =>
        e.target instanceof HTMLSelectElement &&
        e.target.name === "companyId" &&
        setCompanyId(e.target.value)
      }
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
        <SelectField
          key={companyId}
          state={state}
          name="productId"
          label="Product"
          required
          options={options}
          className="sm:col-span-2"
        />
        <SelectField
          state={state}
          name="type"
          label="Type"
          required
          options={TYPES}
          defaultValue="DELIVERY_DAMAGE"
          className="sm:col-span-2"
        />
        <TextField
          state={state}
          name="claimDate"
          label="Date"
          type="date"
          required
          defaultValue={today}
        />
        <TextField
          state={state}
          name="quantity"
          label="Quantity (packets)"
          hint="12 packets = 1 dozen"
          required
          inputMode="numeric"
        />
        {showRate ? (
          <TextField
            state={state}
            name="rate"
            label="Rate / dz"
            inputMode="decimal"
            hint="Blank = purchase rate"
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
      <p className="text-muted-foreground text-sm">
        The claim is valued at purchase cost, reduces what you owe the company now, and is deducted
        on its next bill.
      </p>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Log claim"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/purchases/claims">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
