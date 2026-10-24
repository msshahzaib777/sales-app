"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  {
    href: "/purchases",
    label: "Purchase orders",
    match: (p: string) => p === "/purchases" || p.startsWith("/purchases/orders"),
  },
  {
    href: "/purchases/receipts",
    label: "Goods receipts",
    match: (p: string) => p.startsWith("/purchases/receipts"),
  },
  {
    href: "/purchases/bills",
    label: "Company bills",
    match: (p: string) => p.startsWith("/purchases/bills"),
    money: true,
  },
  {
    href: "/purchases/payments",
    label: "Payments",
    match: (p: string) => p.startsWith("/purchases/payments"),
    money: true,
  },
  {
    href: "/purchases/claims",
    label: "Claims",
    match: (p: string) => p.startsWith("/purchases/claims"),
    money: true,
  },
];

/** Section tabs. Money tabs only for roles that handle payments (decided on the server). */
export function PurchasesTabs({ showMoney }: { showMoney: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Purchases" className="mb-6 flex flex-wrap gap-1 border-b print:hidden">
      {TABS.filter((t) => showMoney || !t.money).map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:text-foreground -mb-px border-b-2 px-3 py-2 text-sm font-medium",
              active ? "border-foreground text-foreground" : "border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
