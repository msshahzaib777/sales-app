import {
  BarChart3,
  ClipboardCheck,
  PackagePlus,
  Plus,
  Receipt,
  Scale,
  ShoppingCart,
  Truck,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type QuickAction = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Something is waiting for this: shown first and highlighted. */
  urgent?: string;
};

const ICONS = {
  order: ShoppingCart,
  trip: Truck,
  dayEnd: ClipboardCheck,
  payment: Wallet,
  goods: PackagePlus,
  expense: Receipt,
  adjust: Scale,
  customer: UserPlus,
  report: BarChart3,
  plus: Plus,
} satisfies Record<string, LucideIcon>;

/** The everyday jobs, one click away. Urgent ones (something waiting) come first, highlighted. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const sorted = [...actions.filter((a) => a.urgent), ...actions.filter((a) => !a.urgent)];
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
      {sorted.map((a) => {
        const Icon = ICONS[a.icon];
        return (
          <Link
            key={a.href + a.label}
            href={a.href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
              a.urgent
                ? "border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100"
                : "hover:bg-muted/60",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span>{a.label}</span>
            {a.urgent ? <span className="text-xs font-normal opacity-80">· {a.urgent}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
