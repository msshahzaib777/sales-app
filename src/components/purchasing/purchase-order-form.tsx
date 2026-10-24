"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";

import { type LineDefaults, type LineProduct, ProductLines } from "./product-lines";

export function PurchaseOrderForm({
  action,
  companies,
  products,
  initial,
  showRate,
  isNew,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  companies: { id: string; name: string }[];
  products: (LineProduct & { companyId: string })[];
  initial: {
    companyId?: string;
    orderDate: string;
    expectedDate?: string;
    note?: string;
    lines: LineDefaults;
  };
  showRate: boolean;
  isNew: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const [companyId, setCompanyId] = useState(initial.companyId ?? companies[0]?.id ?? "");

  return (
    <form
      action={(fd) => formAction(isNew ? withRequestId(fd) : fd)}
      className="max-w-5xl space-y-6"
    >
      <div className="grid gap-4 sm:grid-cols-4">
        {isNew ? (
          <div
            className="sm:col-span-2"
            onChange={(e) => e.target instanceof HTMLSelectElement && setCompanyId(e.target.value)}
          >
            <SelectField
              state={state}
              name="companyId"
              label="Company"
              required
              autoFocus
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              defaultValue={companyId}
            />
          </div>
        ) : (
          <div className="sm:col-span-2">
            <p className="text-sm font-medium">Company</p>
            <p className="mt-2">{companies.find((c) => c.id === companyId)?.name}</p>
            <input type="hidden" name="companyId" value={companyId} />
          </div>
        )}
        <TextField
          state={state}
          name="orderDate"
          label="Order date"
          type="date"
          required
          defaultValue={initial.orderDate}
        />
        <TextField
          state={state}
          name="expectedDate"
          label="Expected delivery"
          type="date"
          defaultValue={initial.expectedDate}
        />
        <TextField
          state={state}
          name="note"
          label="Note"
          defaultValue={initial.note}
          className="sm:col-span-4"
          maxLength={500}
        />
      </div>
      <ProductLines
        key={companyId}
        products={products.filter((p) => p.companyId === companyId)}
        defaults={initial.lines}
        showRate={showRate}
        showOrdered={false}
        state={state}
      />
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isNew ? "Save purchase order" : "Save changes"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/purchases">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
