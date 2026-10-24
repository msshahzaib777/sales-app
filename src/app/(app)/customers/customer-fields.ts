import type { FieldDef } from "@/components/master/record-form";

export const CUSTOMER_TYPE_OPTIONS = [
  { value: "RETAILER", label: "Retailer" },
  { value: "WHOLESALER", label: "Wholesaler" },
  { value: "DEALER", label: "Dealer" },
  { value: "BIKE_SUPPLIER", label: "Bike supplier" },
];

export const customerTypeLabel = (type: string) =>
  CUSTOMER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;

type Defaults = {
  name?: string;
  shopName?: string | null;
  type?: string;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  areaId?: string | null;
  routeSequence?: number | null;
  creditLimit?: string | null;
  openingBalances?: Record<string, string>;
};

export function customerFields(
  d: Defaults,
  areas: { id: string; name: string; warehouse: { name: string } }[],
  companies: { id: string; name: string; warehouse: { name: string } }[],
): FieldDef[] {
  return [
    {
      kind: "text",
      name: "name",
      label: "Customer name",
      required: true,
      defaultValue: d.name,
      maxLength: 120,
    },
    {
      kind: "text",
      name: "shopName",
      label: "Shop name",
      defaultValue: d.shopName,
      maxLength: 120,
    },
    {
      kind: "select",
      name: "type",
      label: "Type",
      required: true,
      options: CUSTOMER_TYPE_OPTIONS,
      defaultValue: d.type ?? "RETAILER",
      width: "sm",
    },
    {
      kind: "text",
      name: "phone",
      label: "Phone",
      type: "tel",
      defaultValue: d.phone,
      placeholder: "0300-1234567",
      width: "sm",
    },
    {
      kind: "text",
      name: "whatsapp",
      label: "WhatsApp",
      type: "tel",
      defaultValue: d.whatsapp,
      placeholder: "0300-1234567",
      width: "md",
    },
    {
      kind: "text",
      name: "address",
      label: "Address",
      defaultValue: d.address,
      width: "full",
      maxLength: 200,
    },
    {
      kind: "select",
      name: "areaId",
      label: "Area / route",
      options: areas.map((a) => ({ value: a.id, label: `${a.name} · ${a.warehouse.name}` })),
      placeholder: "No area",
      defaultValue: d.areaId,
    },
    {
      kind: "text",
      name: "routeSequence",
      label: "Visiting order",
      inputMode: "numeric",
      defaultValue: d.routeSequence,
      hint: "Position in the area's delivery route.",
      width: "sm",
    },
    {
      kind: "text",
      name: "creditLimit",
      label: "Credit limit (PKR)",
      inputMode: "decimal",
      defaultValue: d.creditLimit,
      hint: "Leave blank for no limit.",
      width: "sm",
    },
    {
      kind: "openings",
      companies: companies.map((c) => ({ id: c.id, name: c.name, group: c.warehouse.name })),
      defaultValue: d.openingBalances ?? {},
      hint: "What the customer owed for each company when you started using the app. Use a minus sign for an advance. Changing it later posts the difference to the ledger.",
    },
  ];
}
