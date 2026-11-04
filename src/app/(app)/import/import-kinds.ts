import type { Permission } from "@/server/auth/permissions";
import type { ImportKind } from "@/server/services/master/import-rows";

/** The imports, in the order to do them: each needs the names from the ones before. */
export const IMPORTS: {
  kind: ImportKind;
  title: string;
  description: string;
  list: { href: string; label: string };
  /** Beyond masterData.manage. */
  permission?: Permission;
}[] = [
  {
    kind: "companies",
    title: "Companies",
    description:
      "Suppliers whose products you distribute: warehouse, contacts, order booker, payment terms, sack price and what you owe them now.",
    list: { href: "/companies", label: "Companies" },
  },
  {
    kind: "products",
    title: "Products",
    description:
      "Code, name, company, purchase and sale rate per dozen, discount and minimum stock. An existing code is updated.",
    list: { href: "/products", label: "Products" },
    permission: "rates.manage",
  },
  {
    kind: "areas",
    title: "Areas / routes",
    description: "Delivery areas per warehouse, in visiting order. Customers are put in an area.",
    list: { href: "/settings/areas", label: "Areas" },
  },
  {
    kind: "customers",
    title: "Customers (clients)",
    description:
      "Name, shop, type, phone (saved as +92), area, credit limit and what each owes per company now.",
    list: { href: "/customers", label: "Customers" },
  },
];
