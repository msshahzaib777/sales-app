import type { Metadata } from "next";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { requireTenantContext } from "@/server/auth/session";
import { saveExpenseAction } from "@/server/expense-actions";
import { expenseFormOptions } from "@/server/services/expenses";

export const metadata: Metadata = { title: "Add expense" };

export default function NewExpensePage({ searchParams }: PageProps<"/expenses/new">) {
  return (
    <RequirePermission permission="expenses.manage">
      <BackLink href="/expenses">Expenses</BackLink>
      <PageHeader title="Add expense" />
      <Form searchParams={searchParams} />
    </RequirePermission>
  );
}

async function Form({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenantContext("expenses.manage");
  const options = await expenseFormOptions(ctx);
  return (
    <div className="space-y-4">
      <Notice notice={sp.notice} />
      <ExpenseForm
        // A fresh form (and request id) after each save, so the next slip is not a "retry".
        key={crypto.randomUUID()}
        action={saveExpenseAction}
        today={toDateInput(businessToday())}
        categories={options.categories
          .filter((c) => c.isActive)
          .map((c) => ({ value: c.id, label: c.name }))}
        warehouses={options.warehouses.map((w) => ({ value: w.id, label: w.name }))}
        bikes={options.bikes.map((b) => ({ value: b.id, label: b.name }))}
        trips={options.trips.map((t) => ({
          value: t.id,
          label: `#${t.number} · ${formatDate(t.tripDate)} · ${t.bike.name}`,
        }))}
        staff={options.staff.map((s) => ({ value: s.id, label: s.name }))}
      />
    </div>
  );
}
