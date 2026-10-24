import Link from "next/link";

import { SidebarNav } from "./sidebar-nav";

export function AppSidebar() {
  return (
    <aside className="border-sidebar-border bg-sidebar flex w-56 shrink-0 flex-col border-r print:hidden">
      <div className="border-sidebar-border flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">
          Sales App
        </Link>
      </div>
      <SidebarNav />
    </aside>
  );
}
