import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { Notice } from "@/components/master/notice";
import { LinkButton } from "@/components/master/page-helpers";
import { METHOD_LABEL, PaymentBadges } from "@/components/payments/badges";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { listCustomerPayments } from "@/server/services/payments/customer-payments";
import { parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  return (
    <RequirePermission permission="payments.manage">
      <PageHeader
        title="Payments"
        description="Customer payments received at the office or collected at delivery, and cheques."
        actions={<LinkButton href="/payments/new">Receive payment</LinkButton>}
      />
      <Payments searchParams={searchParams} />
    </RequirePermission>
  );
}

async function Payments({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("payments.manage");
  const list = await listCustomerPayments(ctx, {
    q,
    page,
    method: filterParam(sp, "method"),
    status: filterParam(sp, "paymentStatus"),
    cheque: filterParam(sp, "cheque"),
    via: filterParam(sp, "via"),
    ...parseDateRange(sp),
  });
  return (
    <>
      <Notice notice={sp.notice} />
      <p className="mb-3 text-sm">
        <Link href="/payments?cheque=PENDING" className="underline underline-offset-4">
          Cheques waiting to clear
        </Link>
      </p>
      <ListToolbar
        basePath="/payments"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Payment no., customer, shop, cheque no. or reference"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to"), label: "Paid" }}
        filters={[
          {
            name: "method",
            label: "Method",
            value: filterParam(sp, "method"),
            options: Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label })),
          },
          {
            name: "cheque",
            label: "Cheque",
            value: filterParam(sp, "cheque"),
            options: [
              { value: "PENDING", label: "Pending" },
              { value: "CLEARED", label: "Cleared" },
              { value: "BOUNCED", label: "Bounced" },
            ],
          },
          {
            name: "via",
            label: "Received",
            value: filterParam(sp, "via"),
            options: [
              { value: "OFFICE", label: "At the office" },
              { value: "DELIVERY", label: "At delivery" },
            ],
          },
          {
            name: "paymentStatus",
            label: "Status",
            value: filterParam(sp, "paymentStatus"),
            options: [
              { value: "POSTED", label: "Posted" },
              { value: "REVERSED", label: "Reversed" },
            ],
          },
        ]}
      />
      <p className="mb-3 text-sm">
        {list.total} {list.total === 1 ? "payment" : "payments"} ·{" "}
        <strong>{formatMoney(list.totalAmount)}</strong>{" "}
        <span className="text-muted-foreground">(reversed payments not counted)</span>
      </p>
      <DataTable>
        <thead>
          <tr>
            <Th>Payment</Th>
            <Th>Date</Th>
            <Th>Customer</Th>
            <Th>Method</Th>
            <Th>Received</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={7}>No payments match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((p) => (
            <tr key={p.id}>
              <Td>
                <Link
                  href={`/payments/${p.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  #{p.number}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{formatDate(p.paymentDate)}</Td>
              <Td>
                {p.customer.name}
                {p.customer.shopName ? (
                  <div className="text-muted-foreground">{p.customer.shopName}</div>
                ) : null}
              </Td>
              <Td>
                {METHOD_LABEL[p.method]}
                {p.cheque ? (
                  <div className="text-muted-foreground">
                    {p.cheque.chequeNo} · {p.cheque.bankName} · {formatDate(p.cheque.chequeDate)}
                  </div>
                ) : p.reference ? (
                  <div className="text-muted-foreground">{p.reference}</div>
                ) : null}
              </Td>
              <Td>{p.collectedVia === "DELIVERY" ? "At delivery" : "Office"}</Td>
              <Td className="text-right tabular-nums">{formatMoney(p.amount)}</Td>
              <Td>
                <PaymentBadges status={p.status} chequeStatus={p.cheque?.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/payments"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
