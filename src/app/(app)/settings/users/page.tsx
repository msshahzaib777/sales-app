import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { listUsers } from "@/server/services/users";

import { InviteUserForm } from "./invite-user-form";
import { UserRowActions } from "./user-row-actions";

export const metadata: Metadata = { title: "Users" };

export default function UsersPage() {
  return (
    <RequirePermission permission="users.manage">
      <p className="mb-2 text-sm">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          ← Settings
        </Link>
      </p>
      <PageHeader
        title="Users"
        description="People who can sign in to this business. Only owners can manage users."
      />
      <UsersPanel />
    </RequirePermission>
  );
}

async function UsersPanel() {
  const ctx = await requireTenantContext("users.manage");
  const users = await listUsers(ctx);

  return (
    <div className="space-y-8">
      <section aria-labelledby="invite-heading" className="max-w-3xl rounded-lg border p-4">
        <h2 id="invite-heading" className="mb-3 font-medium">
          Add a user
        </h2>
        <InviteUserForm />
      </section>

      <section aria-labelledby="users-heading">
        <h2 id="users-heading" className="mb-3 font-medium">
          {users.length} {users.length === 1 ? "user" : "users"}
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Role
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Last sign-in
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === ctx.user.id;
                return (
                  <tr key={user.id} className="border-b align-top last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {user.name}
                        {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                      </div>
                      <div className="text-muted-foreground">{user.email}</div>
                    </td>
                    <td className="px-3 py-2">{ROLE_LABELS[user.role]}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {user.isActive ? (
                          <Badge variant="secondary">Active</Badge>
                        ) : (
                          <Badge variant="outline">Deactivated</Badge>
                        )}
                        {user.mustChangePassword && user.isActive ? (
                          <Badge variant="outline">Temporary password</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}
                    </td>
                    <td className="px-3 py-2">
                      {isSelf ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <UserRowActions
                          userId={user.id}
                          name={user.name}
                          role={user.role === "SUPER_ADMIN" ? "OWNER" : user.role}
                          isActive={user.isActive}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
