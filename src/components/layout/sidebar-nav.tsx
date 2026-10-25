"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { navItems } from "./nav-items";

/** `visibleHrefs` comes from the server (role-filtered); icons stay on the client. */
export function SidebarNav({ visibleHrefs }: { visibleHrefs: readonly string[] }) {
  return <NavList visibleHrefs={visibleHrefs} pathname={usePathname()} />;
}

/**
 * The same list without reading the URL, for the prerendered shell (on dynamic routes like
 * /customers/[id] the URL is not known at build time).
 */
export function NavList({
  visibleHrefs,
  pathname,
}: {
  visibleHrefs: readonly string[];
  pathname?: string;
}) {
  return (
    <nav aria-label="Main" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-2">
      {navItems
        .filter((item) => visibleHrefs.includes(item.href))
        .map((item) => {
          const active =
            pathname !== undefined &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.title}
              className={cn(
                "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0 focus-visible:ring-2 max-md:justify-center max-md:px-0",
                active && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate group-data-[collapsed=true]/sidebar:sr-only max-md:sr-only">
                {item.title}
              </span>
            </Link>
          );
        })}
    </nav>
  );
}
