import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  {
    href: "/settings/users",
    title: "Users",
    description: "Invite staff, change roles, reset passwords.",
    icon: Users,
  },
];

export default function SettingsPage() {
  return (
    <RequirePermission permission="settings.manage">
      <PageHeader title="Settings" description="Tenant, users, printing and other settings." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ href, title, description, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="hover:bg-accent focus-visible:ring-ring flex gap-3 rounded-lg border p-4 outline-none focus-visible:ring-2"
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                <span className="block font-medium">{title}</span>
                <span className="text-muted-foreground block text-sm">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </RequirePermission>
  );
}
