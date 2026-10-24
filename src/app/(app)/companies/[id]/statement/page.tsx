import type { Metadata } from "next";

import { orNotFound } from "@/components/master/page-helpers";
import { PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { StatementRangeForm } from "@/components/print/range-form";
import { StatementDocument } from "@/components/print/statement-document";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { businessToday } from "@/lib/dates";
import { statementPageCss } from "@/lib/print";
import { requireTenantContext } from "@/server/auth/session";
import { getCompanyLedger } from "@/server/services/purchasing/company-ledger";
import { defaultLedgerRange, parseDateRange } from "@/server/services/purchasing/filters";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Company statement" };

export default function CompanyStatementPage(props: PageProps<"/companies/[id]/statement">) {
  return (
    <MoneyPage>
      <Statement {...props} />
    </MoneyPage>
  );
}

async function Statement({ params, searchParams }: PageProps<"/companies/[id]/statement">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const parsed = parseDateRange(sp);
  const range = parsed.from || parsed.to ? parsed : defaultLedgerRange(businessToday());
  const ctx = await requireTenantContext("ledgers.view");
  const [ledger, profile] = await Promise.all([
    orNotFound(getCompanyLedger(ctx, id, range)),
    getPrintProfile(ctx),
  ]);
  const { company } = ledger;

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar
        back={{ href: `/companies/${id}/ledger`, label: `${company.name} ledger` }}
        hint="Prints on A4"
      />
      <StatementRangeForm range={range} />
      <StatementDocument
        business={profile.business}
        title="Company statement"
        party={
          <>
            <p className="font-semibold">{company.name}</p>
            <p>
              {company.warehouse.name} · payment terms {company.paymentTermsDays} days
            </p>
          </>
        }
        range={range}
        columns={{ increase: "Bills (+)", decrease: "Paid / credit (−)", balance: "We owe" }}
        opening={ledger.opening}
        // Company ledger: credit = bills (we owe more), debit = payments, returns and claims.
        rows={ledger.rows.map((r) => ({ ...r, increase: r.credit, decrease: r.debit }))}
        closing={ledger.closing}
        showCompany={false}
        footer={<p>A negative balance means the company owes us (advance or claims).</p>}
      />
    </div>
  );
}
