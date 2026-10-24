import type { Permission } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import { requireTenantUser } from "@/server/auth/session";

export function NoAccess() {
  return (
    <div className="rounded-lg border p-6">
      <h1 className="text-lg font-semibold">No access</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Your role does not include this page. Ask the owner if you need it.
      </p>
    </div>
  );
}

/** Renders children only for users whose role has `permission` (server-checked). */
export async function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const user = await requireTenantUser();
  return can(user.role, permission) ? children : <NoAccess />;
}
