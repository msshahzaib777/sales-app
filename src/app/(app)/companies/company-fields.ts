import type { FieldDef } from "@/components/master/record-form";

type Defaults = {
  name?: string;
  warehouseId?: string;
  contactName?: string | null;
  phone?: string | null;
  address?: string | null;
  orderBookerName?: string | null;
  orderBookerPhone?: string | null;
  paymentTermsDays?: number;
  openingBalance?: string;
};

export function companyFields(d: Defaults, warehouses: { id: string; name: string }[]): FieldDef[] {
  return [
    {
      kind: "text",
      name: "name",
      label: "Company name",
      required: true,
      defaultValue: d.name,
      maxLength: 120,
    },
    {
      kind: "select",
      name: "warehouseId",
      label: "Warehouse",
      required: true,
      options: warehouses.map((w) => ({ value: w.id, label: w.name })),
      defaultValue: d.warehouseId ?? warehouses[0]?.id,
      hint: "Its stock and customers are handled from this warehouse.",
    },
    { kind: "text", name: "contactName", label: "Contact person", defaultValue: d.contactName },
    {
      kind: "text",
      name: "phone",
      label: "Phone",
      type: "tel",
      defaultValue: d.phone,
      width: "sm",
    },
    { kind: "text", name: "address", label: "Address", defaultValue: d.address, width: "full" },
    {
      kind: "section",
      title: "Order booker",
      description: "The company's person who reports next-day orders (does not log in).",
    },
    {
      kind: "text",
      name: "orderBookerName",
      label: "Booker name",
      defaultValue: d.orderBookerName,
    },
    {
      kind: "text",
      name: "orderBookerPhone",
      label: "Booker phone",
      type: "tel",
      defaultValue: d.orderBookerPhone,
      width: "sm",
    },
    { kind: "section", title: "Payment" },
    {
      kind: "text",
      name: "paymentTermsDays",
      label: "Payment terms (days)",
      required: true,
      inputMode: "numeric",
      defaultValue: d.paymentTermsDays ?? 15,
      hint: "Bill due date = receipt date + these days.",
      width: "sm",
    },
    {
      kind: "text",
      name: "openingBalance",
      label: "Opening balance (PKR)",
      inputMode: "decimal",
      defaultValue: d.openingBalance && d.openingBalance !== "0.00" ? d.openingBalance : "",
      hint: "What you owed this company when you started using the app (minus if they owed you). Changes post the difference to the ledger.",
      width: "md",
    },
  ];
}
