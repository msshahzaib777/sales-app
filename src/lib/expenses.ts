// Expenses (SPEC §9): shared by the server, the forms and new tenants.

/** Categories every tenant starts with; the tenant can add more and deactivate these. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Rent",
  "Salary",
  "Petrol",
  "Vehicle maintenance",
  "Utilities",
  "Loading labour",
  "Tolls",
  "Other",
] as const;

export const PAYMENT_METHOD_LABEL = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  ONLINE: "Online",
} as const;
