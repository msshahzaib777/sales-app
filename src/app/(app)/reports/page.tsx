import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Reports" };

const REPORTS = [
  {
    href: "/reports/analysis",
    title: "Business analysis",
    description:
      "Weekly, monthly or quarterly: sales and profit trends, products in demand or declining, profit per company, and customers who are growing, slipping or paying late.",
  },
  {
    href: "/reports/daily",
    title: "Daily report",
    description:
      "The day-end numbers: products sold, orders delivered, payments received, what customers owe, cash in hand, expenses, profit and stock left.",
  },
  {
    href: "/reports/damage",
    title: "Damage report",
    description:
      "Stock damaged in delivery, weekly or monthly, by driver, trip, product and company. Print, PDF or Excel.",
  },
] as const;

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Operational and financial reports." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="hover:bg-muted/50 block h-full rounded-lg border p-4 transition-colors"
            >
              <p className="font-medium">{r.title}</p>
              <p className="text-muted-foreground mt-1 text-sm">{r.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
