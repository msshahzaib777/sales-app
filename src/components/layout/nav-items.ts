import {
  BarChart3,
  Boxes,
  Building2,
  LayoutDashboard,
  PackagePlus,
  type LucideIcon,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

import type { Permission } from "@/server/auth/permissions";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Shown only to roles with this permission (the page checks it again on the server). */
  permission?: Permission;
};

export const navItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Orders", href: "/orders", icon: ShoppingCart },
  { title: "Delivery", href: "/delivery", icon: Truck },
  { title: "Purchases", href: "/purchases", icon: PackagePlus },
  { title: "Inventory", href: "/inventory", icon: Boxes },
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Companies", href: "/companies", icon: Building2 },
  { title: "Payments", href: "/payments", icon: Wallet, permission: "payments.manage" },
  { title: "Expenses", href: "/expenses", icon: Receipt, permission: "expenses.manage" },
  { title: "Reports", href: "/reports", icon: BarChart3 },
  { title: "Settings", href: "/settings", icon: Settings, permission: "settings.manage" },
];
