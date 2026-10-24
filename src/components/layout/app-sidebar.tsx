import { KeyRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { can, ROLE_LABELS } from "@/server/auth/permissions";
import { getSessionUser } from "@/server/auth/session";

import { LogoutButton } from "./logout-button";
import { navItems } from "./nav-items";
import { NavList, SidebarNav } from "./sidebar-nav";

/** Items everyone sees; shown instantly while the role-specific list streams in. */
const PUBLIC_HREFS = navItems.filter((item) => !item.permission).map((item) => item.href);

export function AppSidebar() {
  return (
    <aside className="border-sidebar-border bg-sidebar flex w-56 shrink-0 flex-col border-r print:hidden">
      <div className="border-sidebar-border flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">
          Sales App
        </Link>
      </div>
      <Suspense fallback={<NavList visibleHrefs={PUBLIC_HREFS} />}>
        <RoleNav />
      </Suspense>
      <div className="border-sidebar-border mt-auto border-t p-3">
        <Suspense fallback={<div className="h-20" />}>
          <UserPanel />
        </Suspense>
      </div>
    </aside>
  );
}

async function RoleNav() {
  const user = await getSessionUser();
  const visible = navItems
    .filter((item) => !item.permission || (user && can(user.role, item.permission)))
    .map((item) => item.href);
  return <SidebarNav visibleHrefs={visible} />;
}

async function UserPanel() {
  const user = await getSessionUser();
  if (!user) return null;
  return (
    <div className="space-y-2 text-sm">
      <div>
        <p className="truncate font-medium">{user.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {ROLE_LABELS[user.role]}
          {user.tenantName ? ` · ${user.tenantName}` : ""}
        </p>
      </div>
      <Link
        href="/account/password"
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs"
      >
        <KeyRound className="size-3.5" aria-hidden />
        Change password
      </Link>
      <LogoutButton />
    </div>
  );
}
