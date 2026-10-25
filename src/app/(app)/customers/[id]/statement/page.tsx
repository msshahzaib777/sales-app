import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { LinkButton, orNotFound } from "@/components/master/page-helpers";
import { PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { StatementRangeForm } from "@/components/print/range-form";
import { StatementDocument } from "@/components/print/statement-document";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { businessToday, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { filterParam } from "@/lib/list-params";
import { statementPageCss } from "@/lib/print";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { companyOptions } from "@/server/services/master/companies";
import { defaultLedgerRange, parseDateRange } from "@/server/services/purchasing/filters";
import { getPrintProfile } from "@/server/services/settings";
import { getCustomerStatement } from "@/server/services/statements";

export const metadata: Metadata = { title: "Customer statement" };

export default function CustomerStatementPage(props: PageProps<"/customers/[id]/statement">) {
  return (
    <RequirePermission permission="ledgers.view">
      <Statement {...props} />
    </RequirePermission>
  );
}

async function Statement({ params, searchParams }: PageProps<"/customers/[id]/statement">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const parsed = parseDateRange(sp);
  const range = parsed.from || parsed.to ? parsed : defaultLedgerRange(businessToday());
  const companyId = filterParam(sp, "companyId");
  const ctx = await requireTenantContext("ledgers.view");
  const [statement, companies, profile] = await Promise.all([
    orNotFound(getCustomerStatement(ctx, id, { ...range, companyId })),
    companyOptions(ctx),
    getPrintProfile(ctx),
  ]);
  const { customer } = statement;
  const exportQuery = new URLSearchParams({
    ...(companyId ? { companyId } : {}),
    ...(range.from ? { from: toDateInput(range.from) } : {}),
    ...(range.to ? { to: toDateInput(range.to) } : {}),
  }).toString();

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar back={{ href: "/customers", label: "Customers" }} hint="Prints on A4">
        <Button asChild variant="outline" size="sm">
          <a href={`/customers/${id}/statement/export?${exportQuery}`}>Download Excel</a>
        </Button>
        {can(ctx.user.role, "payments.manage") ? (
          <LinkButton href={`/payments/new?customerId=${id}`} variant="outline">
            Receive payment
          </LinkButton>
        ) : null}
        <LinkButton href={`/orders/new?customerId=${id}`} variant="outline">
          New order
        </LinkButton>
        {can(ctx.user.role, "payments.manage") ? (
          <LinkButton href={`/customers/${id}/old-bills`} variant="outline">
            Old balance
          </LinkButton>
        ) : null}
      </PrintToolbar>
      <StatementRangeForm range={range}>
        <div className="space-y-1">
          <label htmlFor="companyId" className="text-muted-foreground text-xs font-medium">
            Company
          </label>
          <NativeSelect
            id="companyId"
            name="companyId"
            defaultValue={companyId ?? ""}
            className="w-48"
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </StatementRangeForm>
      <StatementDocument
        business={profile.business}
        title={statement.company ? `Statement · ${statement.company.name}` : "Customer statement"}
        party={
          <>
            <p className="font-semibold">{customer.name}</p>
            {customer.shopName ? <p>{customer.shopName}</p> : null}
            {customer.address ? <p>{customer.address}</p> : null}
            <p>
              {[customer.areaName && `Area: ${customer.areaName}`, customer.phone]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        }
        range={range}
        columns={{ increase: "Bills (+)", decrease: "Received (−)", balance: "Balance due" }}
        opening={statement.opening}
        rows={statement.rows.map((r) => ({ ...r, increase: r.debit, decrease: r.credit }))}
        closing={statement.closing}
        showCompany={!statement.company}
        footer={
          !statement.company && statement.byCompany.length > 1 ? (
            <section className="ml-auto w-[22em] break-inside-avoid">
              <p className="font-semibold">Balance by company (today)</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3">
                {statement.byCompany.map((c) => (
                  <div key={c.companyId} className="contents">
                    <dt>{c.companyName}</dt>
                    <dd className="text-right tabular-nums">{formatMoney(c.balance)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null
        }
      />
    </div>
  );
}
