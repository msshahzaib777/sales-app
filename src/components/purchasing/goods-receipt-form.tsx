"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { type ActionState, idleState } from "@/lib/action-state";

import { type LineDefaults, type LineProduct, ProductLines } from "./product-lines";

/**
 * Goods receipt. Chosen from a purchase order, the remaining quantities are filled in (change them
 * to what actually arrived — less or more is fine). Without an order, any company product.
 */
export function GoodsReceiptForm({
  action,
  companies,
  products,
  openOrders,
  order,
  receivedDate,
  showRate,
  canSetDueDate,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  companies: { id: string; name: string; paymentTermsDays: number }[];
  products: (LineProduct & { companyId: string })[];
  openOrders: { id: string; number: number; companyId: string; companyName: string }[];
  order: { id: string; number: number; companyId: string; lines: LineDefaults } | null;
  receivedDate: string;
  showRate: boolean;
  canSetDueDate: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const router = useRouter();
  const [companyId, setCompanyId] = useState(order?.companyId ?? companies[0]?.id ?? "");
  const company = companies.find((c) => c.id === companyId);

  return (
    <form action={(fd) => formAction(withRequestId(fd))} className="max-w-5xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="purchase-order">Purchase order</Label>
          <NativeSelect
            id="purchase-order"
            value={order?.id ?? ""}
            onChange={(e) =>
              router.push(
                e.target.value
                  ? `/purchases/receipts/new?purchaseOrderId=${e.target.value}`
                  : "/purchases/receipts/new",
              )
            }
          >
            <option value="">No purchase order</option>
            {openOrders.map((o) => (
              <option key={o.id} value={o.id}>
                PO #{o.number} · {o.companyName}
              </option>
            ))}
          </NativeSelect>
          <input type="hidden" name="purchaseOrderId" value={order?.id ?? ""} />
        </div>
        {order ? (
          <div className="sm:col-span-2">
            <p className="text-sm font-medium">Company</p>
            <p className="mt-2">{company?.name}</p>
            <input type="hidden" name="companyId" value={companyId} />
          </div>
        ) : (
          <div
            className="sm:col-span-2"
            onChange={(e) => e.target instanceof HTMLSelectElement && setCompanyId(e.target.value)}
          >
            <SelectField
              state={state}
              name="companyId"
              label="Company"
              required
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              defaultValue={companyId}
            />
          </div>
        )}
        <TextField
          state={state}
          name="receivedDate"
          label="Received on"
          type="date"
          required
          defaultValue={receivedDate}
          autoFocus
        />
        <TextField state={state} name="supplierRef" label="Company invoice no." maxLength={60} />
        {canSetDueDate ? (
          <TextField
            state={state}
            name="dueDate"
            label="Bill due date"
            type="date"
            hint={`Blank = received date + ${company?.paymentTermsDays ?? 0} days`}
          />
        ) : null}
        <TextField
          state={state}
          name="note"
          label="Note"
          maxLength={500}
          className={canSetDueDate ? "" : "sm:col-span-2"}
        />
      </div>
      <ProductLines
        key={`${companyId}-${order?.id ?? ""}`}
        products={products.filter((p) => p.companyId === companyId)}
        defaults={order?.lines ?? {}}
        showRate={showRate}
        showOrdered={Boolean(order)}
        state={state}
      />
      <p className="text-muted-foreground text-sm">
        Posting adds the stock as a new batch and creates the company bill. Pending damage claims
        are deducted on this bill.
      </p>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Posting…" : "Post receipt"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/purchases/receipts">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
