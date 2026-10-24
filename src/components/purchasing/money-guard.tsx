import { RequirePermission } from "@/components/layout/no-access";

/** Bills, payments, claims and ledgers are for roles that handle money (owner, accountant). */
export function MoneyPage({ children }: { children: React.ReactNode }) {
  return <RequirePermission permission="payments.manage">{children}</RequirePermission>;
}
