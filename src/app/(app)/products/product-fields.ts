import type { FieldDef } from "@/components/master/record-form";
import { PACKETS_PER_DOZEN } from "@/lib/units";

export const DISCOUNT_TYPE_OPTIONS = [
  { value: "NONE", label: "No discount" },
  { value: "AMOUNT_PER_UNIT", label: "Rs per dozen" },
  { value: "PERCENT", label: "Percent (%)" },
];

const dozens = (halfDozens: number) => String(halfDozens / PACKETS_PER_DOZEN);

type Defaults = {
  companyId?: string;
  code?: string;
  name?: string;
  purchaseRate?: string;
  saleRate?: string;
  discountType?: string;
  discountValue?: string;
  minStockLevel?: number;
  slabs?: { minQuantity: number; discountValue: string }[];
};

export function productFields(
  d: Defaults,
  companies: { id: string; name: string }[],
  today: string,
): FieldDef[] {
  return [
    {
      kind: "select",
      name: "companyId",
      label: "Company",
      required: true,
      options: companies.map((c) => ({ value: c.id, label: c.name })),
      defaultValue: d.companyId ?? companies[0]?.id,
    },
    {
      kind: "text",
      name: "code",
      label: "Short code",
      required: true,
      defaultValue: d.code,
      maxLength: 12,
      hint: "For quick search in order entry, e.g. CB01.",
      width: "sm",
    },
    {
      kind: "text",
      name: "name",
      label: "Product name",
      required: true,
      defaultValue: d.name,
      maxLength: 120,
      width: "full",
    },
    {
      kind: "section",
      title: "Rates (PKR per dozen)",
      description: "Every change to rates, discount or slabs is kept in price history.",
    },
    {
      kind: "text",
      name: "purchaseRate",
      label: "Purchase rate",
      required: true,
      inputMode: "decimal",
      defaultValue: d.purchaseRate,
      width: "sm",
    },
    {
      kind: "text",
      name: "saleRate",
      label: "Sale rate",
      required: true,
      inputMode: "decimal",
      defaultValue: d.saleRate,
      width: "sm",
    },
    {
      kind: "text",
      name: "effectiveFrom",
      label: "New rates effective from",
      type: "date",
      required: true,
      defaultValue: today,
      hint: "Used only if rates change.",
      width: "md",
    },
    {
      kind: "select",
      name: "discountType",
      label: "Company discount",
      options: DISCOUNT_TYPE_OPTIONS,
      defaultValue: d.discountType ?? "AMOUNT_PER_UNIT",
      width: "sm",
    },
    {
      kind: "text",
      name: "discountValue",
      label: "Discount",
      inputMode: "decimal",
      defaultValue: d.discountValue && Number(d.discountValue) !== 0 ? d.discountValue : "",
      hint: "Rs per dozen, or percent.",
      width: "sm",
    },
    {
      kind: "slabs",
      discountTypeField: "discountType",
      defaultValue: (d.slabs ?? []).map((s) => ({
        fromDozens: dozens(s.minQuantity),
        value: s.discountValue,
      })),
    },
    { kind: "section", title: "Stock" },
    {
      kind: "text",
      name: "minStockLevel",
      label: "Minimum stock (dozens)",
      inputMode: "decimal",
      defaultValue: d.minStockLevel ? dozens(d.minStockLevel) : "",
      hint: "Below this, the product shows as low stock.",
      width: "md",
    },
  ];
}
