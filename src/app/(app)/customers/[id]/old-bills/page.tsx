import type { Metadata } from "next";

import { ReasonAction } from "@/components/form/reason-action";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { Notice } from "@/components/master/notice";
import { orNotFound } from "@/components/master/page-helpers";
import { OldBillForm } from "@/components/payments/old-bill-form";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { requireTenantContext } from "@/server/auth/session";
import { removeOldBillAction, saveOldBillAction } from "@/server/payment-actions";
import { listOldBills } from "@/server/services/payments/old-bills";

export const metadata: Metadata = { title: "Old balance" };

export default function OldBillsPage(props: PageProps<"/customers/[id]/old-bills">) {
  return (
    <RequirePermission permission="payments.manage">
      <OldBills {...props} />
    </RequirePermission>
  );
}

async function OldBills({ params, searchParams }: PageProps<"/customers/[id]/old-bills">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext("payments.manage");
  const data = await orNotFound(listOldBills(ctx, id));
  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/customers/${id}/statement`}>Statement</BackLink>
        <PageHeader
          title={`Old balance · ${data.customer.name}`}
          description="Unpaid paper bills from before the app. They are owed to us, not to a company: they count in what the customer owes, show as “Old balance” on bills and statements, are paid before anything else, and are left out of every company figure."
        />
      </div>
      <Notice notice={sp.notice} />
      <p className="text-sm">
        Unpaid now <strong className="tabular-nums">{formatMoney(data.unpaid)}</strong> of{" "}
        <span className="tabular-nums">{formatMoney(data.total)}</span>
      </p>
      <DataTable>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Bill no.</Th>
            <Th>Note</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Paid</Th>
            <Th className="text-right">Unpaid</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? <EmptyRow colSpan={7}>No old bills yet.</EmptyRow> : null}
          {data.rows.map((b) => (
            <tr
              key={b.id}
              className={b.status === "REVERSED" ? "text-muted-foreground" : undefined}
            >
              <Td>{formatDate(b.billDate)}</Td>
              <Td>{b.billNo ?? ""}</Td>
              <Td>
                {b.note ?? ""}
                {b.status === "REVERSED" ? (
                  <div className="text-xs">Removed: {b.reversalReason}</div>
                ) : null}
              </Td>
              <Td className="text-right tabular-nums">{formatMoney(b.amount)}</Td>
              <Td className="text-right tabular-nums">
                {b.status === "POSTED" ? formatMoney(b.paid) : ""}
              </Td>
              <Td className="text-right tabular-nums">
                {b.status === "POSTED" ? formatMoney(b.unpaid) : ""}
              </Td>
              <Td>
                {b.status === "POSTED" ? (
                  <ReasonAction
                    action={removeOldBillAction.bind(null, b.id, id)}
                    label="Remove"
                    description="For a bill entered by mistake. A reversal goes into the customer's ledger. Not possible once payments have used it up."
                  />
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <section aria-labelledby="add-heading" className="space-y-3">
        <h2 id="add-heading" className="font-medium">
          Add an old bill
        </h2>
        <OldBillForm
          // A new form (and requestId) after each save, so the next bill is not taken for a retry.
          key={data.rows.length}
          action={saveOldBillAction.bind(null, id)}
          today={toDateInput(businessToday())}
        />
      </section>
    </div>
  );
}
