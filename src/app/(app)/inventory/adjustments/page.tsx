import type { Metadata } from "next";

import { ConfirmAction } from "@/components/form/confirm-action";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { Notice } from "@/components/master/notice";
import { LinkButton } from "@/components/master/page-helpers";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { formatDozens } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { decideAdjustmentAction } from "@/server/inventory-actions";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { ADJUSTMENT_REASON_LABEL, listAdjustments } from "@/server/services/stock-adjustments";

export const metadata: Metadata = { title: "Stock adjustments" };

const KIND = { SHORT: "Short", EXTRA: "Extra found", DAMAGED: "Damaged in warehouse" } as const;
const STATUS = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
} as const;

export default function AdjustmentsPage({ searchParams }: PageProps<"/inventory/adjustments">) {
  return (
    <RequirePermission permission="stock.requestAdjustment">
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader
        title="Stock adjustments"
        description="Stock that is short, extra or damaged in the warehouse. Staff adjustments wait for the owner's approval; only approved ones change stock."
        actions={<LinkButton href="/inventory/adjustments/new">Adjust stock</LinkButton>}
      />
      <Adjustments searchParams={searchParams} />
    </RequirePermission>
  );
}

async function Adjustments({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("stock.requestAdjustment");
  const approver = can(ctx.user.role, "stock.approveAdjustment");
  const list = await listAdjustments(ctx, {
    q,
    page,
    status: filterParam(sp, "adjustmentStatus"),
    ...parseDateRange(sp),
  });
  return (
    <>
      <Notice notice={sp.notice} />
      {list.pending > 0 ? (
        <p className="mb-3 text-sm" role="status">
          <strong>{list.pending}</strong> waiting for approval
          {approver ? " — approve or reject them below." : "."}
        </p>
      ) : null}
      <ListToolbar
        basePath="/inventory/adjustments"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Product code, name or note"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to") }}
        filters={[
          {
            name: "adjustmentStatus",
            label: "Status",
            value: filterParam(sp, "adjustmentStatus"),
            options: Object.entries(STATUS).map(([value, label]) => ({ value, label })),
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Product</Th>
            <Th>What happened</Th>
            <Th className="text-right">Quantity</Th>
            <Th>By</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={6}>No stock adjustments match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((a) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap">{formatDate(a.createdAt)}</Td>
              <Td>
                <span className="font-mono">{a.product.code}</span> {a.product.name}
                <div className="text-muted-foreground text-xs">{a.warehouse.name}</div>
              </Td>
              <Td>
                {KIND[a.kind]}
                {a.kind === "DAMAGED" ? null : (
                  <span className="text-muted-foreground">
                    {" "}
                    · {ADJUSTMENT_REASON_LABEL[a.reason]}
                  </span>
                )}
                {a.note ? <div className="text-muted-foreground text-xs">{a.note}</div> : null}
              </Td>
              <Td className="text-right whitespace-nowrap tabular-nums">
                {a.quantity > 0 ? "+" : "−"}
                {formatDozens(Math.abs(a.quantity))}
              </Td>
              <Td className="text-xs">
                {a.requestedBy}
                {a.decidedBy && a.decidedBy !== a.requestedBy ? (
                  <div className="text-muted-foreground">
                    {a.status === "APPROVED" ? "approved" : "rejected"} by {a.decidedBy}
                  </div>
                ) : null}
              </Td>
              <Td className="space-y-2">
                <Badge
                  variant={
                    a.status === "PENDING"
                      ? "default"
                      : a.status === "APPROVED"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {STATUS[a.status]}
                </Badge>
                {a.status === "PENDING" && approver ? (
                  <div className="flex flex-wrap gap-2">
                    <ConfirmAction
                      action={decideAdjustmentAction.bind(null, a.id, true)}
                      label="Approve"
                      confirm={`Approve: ${KIND[a.kind].toLowerCase()} ${formatDozens(Math.abs(a.quantity))} of ${a.product.name}? Stock changes now.`}
                    />
                    <ConfirmAction
                      action={decideAdjustmentAction.bind(null, a.id, false)}
                      label="Reject"
                      confirm={`Reject this adjustment of ${a.product.name}? Stock stays as it is.`}
                    />
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/inventory/adjustments"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
