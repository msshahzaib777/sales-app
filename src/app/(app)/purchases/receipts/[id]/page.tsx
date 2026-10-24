import type { Metadata } from "next";
import Link from "next/link";

import { ReasonAction } from "@/components/form/reason-action";
import { DataTable, Td, Th } from "@/components/list/data-table";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { orNotFound } from "@/components/master/page-helpers";
import { PostingBadge } from "@/components/purchasing/status-badges";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { cancelGoodsReceiptAction } from "@/server/purchasing-actions";
import { getGoodsReceipt } from "@/server/services/purchasing/goods-receipts";

export const metadata: Metadata = { title: "Goods receipt" };

export default async function GoodsReceiptPage({
  params,
  searchParams,
}: PageProps<"/purchases/receipts/[id]">) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext("operations.manage");
  const r = await orNotFound(getGoodsReceipt(ctx, id));
  const showMoney = r.companyBill !== null;
  const bill = r.companyBill;

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/purchases/receipts">Goods receipts</BackLink>
        <PageHeader
          title={`Goods receipt #${r.number}`}
          description={`${r.company.name} · ${r.warehouse.name} · received ${formatDate(r.receivedDate)}${r.supplierRef ? ` · invoice ${r.supplierRef}` : ""}`}
        />
        <Notice notice={notice} />
        <PostingBadge status={r.status} />
        {r.status === "REVERSED" ? (
          <p className="mt-2 text-sm">Cancelled: {r.reversalReason}</p>
        ) : null}
        {r.purchaseOrder ? (
          <p className="mt-2 text-sm">
            For{" "}
            <Link
              href={`/purchases/orders/${r.purchaseOrder.id}`}
              className="underline underline-offset-4"
            >
              purchase order #{r.purchaseOrder.number}
            </Link>
          </p>
        ) : null}
      </div>
      <DataTable>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Product</Th>
            <Th className="text-right">Received</Th>
            {showMoney ? <Th className="text-right">Rate / dz</Th> : null}
            {showMoney ? <Th className="text-right">Amount</Th> : null}
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id}>
              <Td className="font-mono">{l.product.code}</Td>
              <Td>{l.product.name}</Td>
              <Td className="text-right tabular-nums">{formatDozens(l.quantity)}</Td>
              {showMoney ? (
                <Td className="text-right tabular-nums">{formatMoney(l.rate)}</Td>
              ) : null}
              {showMoney ? (
                <Td className="text-right tabular-nums">{formatMoney(l.amount)}</Td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </DataTable>
      {bill ? (
        <section
          aria-labelledby="bill-heading"
          className="max-w-md space-y-1 rounded-lg border p-4 text-sm"
        >
          <h2 id="bill-heading" className="font-medium">
            <Link href={`/purchases/bills/${bill.id}`} className="underline underline-offset-4">
              Company bill #{bill.number}
            </Link>
          </h2>
          <p>Goods: {formatMoney(bill.grossAmount)}</p>
          {bill.claimDeduction.gt(0) ? (
            <p>Claims deducted: −{formatMoney(bill.claimDeduction)}</p>
          ) : null}
          <p className="font-medium">To pay: {formatMoney(bill.netAmount)}</p>
          <p>Due {formatDate(bill.dueDate)}</p>
        </section>
      ) : null}
      {r.status === "POSTED" && can(ctx.user.role, "documents.reverse") ? (
        <ReasonAction
          action={cancelGoodsReceiptAction.bind(null, r.id)}
          label="Cancel receipt"
          description="Cancelling reverses the stock and the company bill. It is only possible while none of this stock was used and nothing was paid on the bill."
        />
      ) : null}
    </div>
  );
}
