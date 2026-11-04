import type { ClaimType } from "@/generated/prisma/enums";

import { formatDozens } from "./units";

// How company claims (credits against a company, deducted on its next bill) are named on screens
// and bills. Shared so the claims list and the company bill say the same.

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  DELIVERY_DAMAGE: "Delivery damage",
  RETURN_TO_COMPANY: "Returned to company",
  OTHER: "Other",
  SACK_RETURN: "Sacks returned",
  BOOKER_SALARY: "Booker salary (paid for company)",
  COMPANY_EXPENSE: "Expense (paid for company)",
};

type Claim = { type: ClaimType; quantity: number; product: { name: string } | null };

/** What the claim is for: the product, or empty sacks, a booker salary, an expense. */
export function claimItem(c: Claim): string {
  if (c.type === "BOOKER_SALARY") return "Booker salary";
  if (c.type === "COMPANY_EXPENSE") return "Company expense";
  return c.product?.name ?? "Empty sacks";
}

/** Its quantity: dozens of a product, a number of sacks, or nothing for money we paid. */
export function claimQuantity(c: Claim): string {
  if (c.type === "BOOKER_SALARY" || c.type === "COMPANY_EXPENSE") return "—";
  if (c.type === "SACK_RETURN" || !c.product) return `${c.quantity} sacks`;
  return formatDozens(c.quantity);
}
