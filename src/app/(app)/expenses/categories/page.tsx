import type { Metadata } from "next";

import { ConfirmAction } from "@/components/form/confirm-action";
import { CategoryForm } from "@/components/expenses/category-form";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { DataTable, Td, Th } from "@/components/list/data-table";
import { Badge } from "@/components/ui/badge";
import { requireTenantContext } from "@/server/auth/session";
import { addExpenseCategoryAction, setExpenseCategoryActiveAction } from "@/server/expense-actions";
import { expenseFormOptions } from "@/server/services/expenses";

export const metadata: Metadata = { title: "Expense categories" };

export default function ExpenseCategoriesPage() {
  return (
    <RequirePermission permission="expenses.manage">
      <BackLink href="/expenses">Expenses</BackLink>
      <PageHeader
        title="Expense categories"
        description="Switch off a category you no longer use; its old expenses keep it."
      />
      <Categories />
    </RequirePermission>
  );
}

async function Categories() {
  const ctx = await requireTenantContext("expenses.manage");
  const { categories } = await expenseFormOptions(ctx);
  return (
    <div className="max-w-xl space-y-4">
      <CategoryForm action={addExpenseCategoryAction} />
      <DataTable>
        <thead>
          <tr>
            <Th>Category</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id} className={c.isActive ? undefined : "text-muted-foreground"}>
              <Td>
                {c.name} {c.isActive ? null : <Badge variant="outline">Off</Badge>}
              </Td>
              <Td className="text-right">
                <ConfirmAction
                  action={setExpenseCategoryActiveAction.bind(null, c.id, !c.isActive)}
                  label={c.isActive ? "Switch off" : "Switch on"}
                  confirm={
                    c.isActive
                      ? `Switch off "${c.name}"? It can't be chosen for new expenses.`
                      : `Switch "${c.name}" back on?`
                  }
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}
