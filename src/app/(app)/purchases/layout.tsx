import { RequirePermission } from "@/components/layout/no-access";
import { PurchasesTabs } from "@/components/purchasing/purchases-tabs";
import { can } from "@/server/auth/permissions";
import { requireTenantUser } from "@/server/auth/session";

export default async function PurchasesLayout({ children }: LayoutProps<"/purchases">) {
  const user = await requireTenantUser();
  return (
    <RequirePermission permission="operations.manage">
      <PurchasesTabs showMoney={can(user.role, "payments.manage")} />
      {children}
    </RequirePermission>
  );
}
