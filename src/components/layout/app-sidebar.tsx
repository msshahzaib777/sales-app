import { KeyRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { APP_NAME } from "@/lib/brand";
import { can, ROLE_LABELS } from "@/server/auth/permissions";
import { getSessionUser } from "@/server/auth/session";

import { LogoutButton } from "./logout-button";
import { navItems } from "./nav-items";
import { NavList, SidebarNav } from "./sidebar-nav";
import { SIDEBAR_INIT_SCRIPT, SidebarToggle } from "./sidebar-toggle";

/** Items everyone sees; shown instantly while the role-specific list streams in. */
const PUBLIC_HREFS = navItems.filter((item) => !item.permission).map((item) => item.href);

export function AppSidebar() {
  return (
    // suppressHydrationWarning: the inline script may set data-collapsed before React loads.
    <aside
      suppressHydrationWarning
      className="group/sidebar border-sidebar-border bg-sidebar sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r transition-[width] data-[collapsed=true]:w-14 print:hidden"
    >
      {/* Before paint: the saved collapsed state (see SidebarToggle). */}
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      <div className="border-sidebar-border flex h-14 items-center justify-between gap-2 border-b px-4 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-2">
        <Link
          href="/dashboard"
          className="truncate text-base font-semibold tracking-tight group-data-[collapsed=true]/sidebar:hidden"
        >
          {APP_NAME}
        </Link>
        <SidebarToggle />
      </div>
      <Suspense fallback={<NavList visibleHrefs={PUBLIC_HREFS} />}>
        <RoleNav />
      </Suspense>
      <div className="border-sidebar-border mt-auto border-t p-3 group-data-[collapsed=true]/sidebar:px-1.5">
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
      <div className="group-data-[collapsed=true]/sidebar:hidden">
        <p className="truncate font-medium">{user.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {ROLE_LABELS[user.role]}
          {user.tenantName ? ` · ${user.tenantName}` : ""}
        </p>
      </div>
      <Link
        href="/account/password"
        title="Change password"
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs group-data-[collapsed=true]/sidebar:justify-center"
      >
        <KeyRound className="size-3.5" aria-hidden />
        <span className="group-data-[collapsed=true]/sidebar:sr-only">Change password</span>
      </Link>
      <LogoutButton />
    </div>
  );
}
