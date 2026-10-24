import type { Metadata } from "next";
import Link from "next/link";

import { ReasonAction } from "@/components/form/reason-action";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { LinkButton } from "@/components/master/page-helpers";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { SettleClaimForm } from "@/components/purchasing/settle-claim-form";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { cancelClaimAction, settleClaimAction } from "@/server/purchasing-actions";
import { companyOptions } from "@/server/services/master/companies";
import { listClaims } from "@/server/services/purchasing/claims";
import { parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Company claims" };

const TYPE = {
  DELIVERY_DAMAGE: "Delivery damage",
  RETURN_TO_COMPANY: "Returned to company",
  OTHER: "Other",
} as const;
const STATUS = {
  AWAITING: "Pending: settle with company",
  PENDING: "Accepted: to deduct on next bill",
  APPLIED: "Deducted",
  REJECTED: "Rejected",
  REVERSED: "Cancelled",
} as const;

export default function ClaimsPage({ searchParams }: PageProps<"/purchases/claims">) {
  return (
    <MoneyPage>
      <PageHeader
        title="Company claims"
        description="Credits against companies. Damage from day-end waits here until you settle it with the company: accept it (in full or for less) or reject it. Accepted claims are deducted on the company's next bill."
        actions={<LinkButton href="/purchases/claims/new">Log claim</LinkButton>}
      />
      <Claims searchParams={searchParams} />
    </MoneyPage>
  );
}

async function Claims({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("payments.manage");
  const [list, companies] = await Promise.all([
    listClaims(ctx, {
      q,
      page,
      companyId: filterParam(sp, "companyId"),
      status: filterParam(sp, "claimStatus"),
      ...parseDateRange(sp),
    }),
    companyOptions(ctx),
  ]);
  return (
    <>
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/purchases/claims"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Claim no., product or note"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to") }}
        filters={[
          {
            name: "companyId",
            label: "Company",
            value: filterParam(sp, "companyId"),
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "claimStatus",
            label: "Status",
            value: filterParam(sp, "claimStatus"),
            options: Object.entries(STATUS).map(([value, label]) => ({ value, label })),
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Claim</Th>
            <Th>Date</Th>
            <Th>Company</Th>
            <Th>Product</Th>
            <Th>Type</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={8}>No claims match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((c) => (
            <tr
              key={c.id}
              id={c.id}
              className={filterParam(sp, "highlight") === c.id ? "bg-muted" : undefined}
            >
              <Td className="font-medium">#{c.number}</Td>
              <Td className="whitespace-nowrap">{formatDate(c.claimDate)}</Td>
              <Td>{c.company.name}</Td>
              <Td>
                <span className="font-mono">{c.product.code}</span> {c.product.name}
                {c.note ? <div className="text-muted-foreground">{c.note}</div> : null}
              </Td>
              <Td>{TYPE[c.type]}</Td>
              <Td className="text-right tabular-nums">{formatDozens(c.quantity)}</Td>
              <Td className="text-right tabular-nums">
                {formatMoney(c.amount)}
                {c.claimedAmount && !c.claimedAmount.eq(c.amount) ? (
                  <div className="text-muted-foreground text-xs">
                    claimed {formatMoney(c.claimedAmount)}
                  </div>
                ) : null}
              </Td>
              <Td className="space-y-2">
                <Badge
                  variant={
                    c.status === "AWAITING"
                      ? "default"
                      : c.status === "PENDING"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {STATUS[c.status]}
                </Badge>
                {c.settlementNote ? (
                  <div className="text-muted-foreground text-xs">{c.settlementNote}</div>
                ) : null}
                {c.status === "AWAITING" ? (
                  <SettleClaimForm
                    action={settleClaimAction.bind(null, c.id)}
                    number={c.number}
                    claimed={c.amount.toFixed(2)}
                  />
                ) : null}
                {c.appliedToBill ? (
                  <div>
                    <Link
                      href={`/purchases/bills/${c.appliedToBill.id}`}
                      className="text-xs underline underline-offset-4"
                    >
                      on bill #{c.appliedToBill.number}
                    </Link>
                  </div>
                ) : null}
                {c.status === "PENDING" || c.status === "AWAITING" ? (
                  <ReasonAction
                    action={cancelClaimAction.bind(null, c.id)}
                    label="Cancel"
                    description={
                      c.status === "AWAITING"
                        ? `Cancel claim #${c.number}? Use this for a claim logged by mistake; use Reject when the company refused it.`
                        : `Cancel claim #${c.number}? Its credit is reversed.`
                    }
                  />
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/purchases/claims"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
