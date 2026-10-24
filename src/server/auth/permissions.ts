import type { Role } from "@/generated/prisma/enums";

// Server-side permission checks (CLAUDE.md rule 8). The UI may hide things too, but every server
// action and data read must call `assertCan` / `can` itself.
//
// SPEC §2 says roles will become configurable per tenant; until then this table is the source.

export const PERMISSIONS = [
  /** Invite, change role, deactivate and reset passwords of tenant users. */
  "users.manage",
  /** Tenant settings: business details, printing, feature switches. */
  "settings.manage",
  /** Warehouses, companies, products, customers, areas, bikes, staff. */
  "masterData.manage",
  /** Change purchase/sale rates and discounts. */
  "rates.manage",
  /** Sales orders, purchases, deliveries, day-end entries. */
  "operations.manage",
  /** Request a stock adjustment (stays pending). */
  "stock.requestAdjustment",
  /** Approve or reject stock adjustments. */
  "stock.approveAdjustment",
  /** Record customer and company payments, cheques. */
  "payments.manage",
  /** Customer, company and staff ledgers. */
  "ledgers.view",
  /** Expenses and payroll. */
  "expenses.manage",
  /** Profit, margin and purchase-cost figures. Staff must never see these. */
  "financials.view",
  /** Allow an order past the customer's credit limit. */
  "orders.overrideCreditLimit",
  /** Read the audit log. */
  "audit.view",
  /** Cancel posted documents that move stock (e.g. a goods receipt entered by mistake). */
  "documents.reverse",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

type TenantRole = Exclude<Role, "SUPER_ADMIN">;

const ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ACCOUNTANT: [
    "operations.manage",
    "stock.requestAdjustment",
    "payments.manage",
    "ledgers.view",
    "expenses.manage",
    "financials.view",
  ],
  STAFF: ["operations.manage", "stock.requestAdjustment"],
};

/** SUPER_ADMIN is platform-level and has no tenant permissions (support access comes in Phase 5). */
export function can(role: Role, permission: Permission): boolean {
  if (role === "SUPER_ADMIN") return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`You do not have permission to do this (${permission}).`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super admin",
  OWNER: "Owner",
  ACCOUNTANT: "Accountant",
  STAFF: "Data entry staff",
};

/** Roles an owner can give to tenant users. */
export const TENANT_ROLES = [
  "OWNER",
  "ACCOUNTANT",
  "STAFF",
] as const satisfies readonly TenantRole[];
