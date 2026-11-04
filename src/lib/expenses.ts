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

/** Category of booker salaries paid for companies (made when first used). */
export const BOOKER_SALARY_CATEGORY = "Booker salary (company pays back)";

export const CHARGE_TO_LABEL = {
  OWN: "Our own expense",
  BOOKER_SALARY: "Booker salary, for a company",
  COMPANY_EXPENSE: "Expense for a company",
} as const;

export const PAYMENT_METHOD_LABEL = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  ONLINE: "Online",
} as const;
