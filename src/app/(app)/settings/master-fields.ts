import type { FieldDef } from "@/components/master/record-form";
import { quantityText } from "@/lib/units";

type Option = { id: string; name: string };
const opts = (list: Option[]) => list.map((o) => ({ value: o.id, label: o.name }));

export function warehouseFields(d: { name?: string; address?: string | null }): FieldDef[] {
  return [
    {
      kind: "text",
      name: "name",
      label: "Warehouse name",
      required: true,
      defaultValue: d.name,
      maxLength: 80,
    },
    {
      kind: "text",
      name: "address",
      label: "Address",
      defaultValue: d.address,
      width: "full",
      maxLength: 200,
    },
  ];
}

export function areaFields(
  d: { name?: string; warehouseId?: string; sortOrder?: number },
  warehouses: Option[],
): FieldDef[] {
  return [
    {
      kind: "text",
      name: "name",
      label: "Area / route name",
      required: true,
      defaultValue: d.name,
      maxLength: 80,
    },
    {
      kind: "select",
      name: "warehouseId",
      label: "Warehouse",
      required: true,
      options: opts(warehouses),
      defaultValue: d.warehouseId ?? warehouses[0]?.id,
    },
    {
      kind: "text",
      name: "sortOrder",
      label: "Order",
      inputMode: "numeric",
      defaultValue: d.sortOrder ?? 0,
      hint: "Areas with close numbers are planned together.",
      width: "sm",
    },
  ];
}

export function bikeFields(
  d: { name?: string; warehouseId?: string | null; capacity?: number; driverId?: string | null },
  warehouses: Option[],
  drivers: Option[],
): FieldDef[] {
  return [
    {
      kind: "text",
      name: "name",
      label: "Bike name or number",
      required: true,
      defaultValue: d.name,
      maxLength: 60,
    },
    {
      kind: "text",
      name: "capacity",
      label: "Capacity (dozens)",
      required: true,
      inputMode: "decimal",
      defaultValue: d.capacity ? quantityText(d.capacity) : "",
      hint: "Usually 80–100 dozen.",
      width: "sm",
    },
    {
      kind: "select",
      name: "warehouseId",
      label: "Warehouse",
      options: opts(warehouses),
      placeholder: "Any",
      defaultValue: d.warehouseId,
      width: "sm",
    },
    {
      kind: "select",
      name: "driverId",
      label: "Driver",
      options: opts(drivers),
      placeholder: "No driver",
      defaultValue: d.driverId,
      hint: drivers.length === 0 ? "Add staff with the Driver role first." : undefined,
    },
  ];
}

export const STAFF_ROLE_OPTIONS = [
  { value: "DRIVER", label: "Driver" },
  { value: "OFFICE", label: "Office" },
  { value: "LOADER", label: "Loader" },
  { value: "OTHER", label: "Other" },
];

export function staffFields(
  d: {
    id?: string;
    name?: string;
    role?: string;
    phone?: string | null;
    monthlySalary?: string;
    joiningDate?: string | null;
  },
  bikes: { id: string; name: string; driverId: string | null; driver: { name: string } | null }[],
): FieldDef[] {
  const current = d.id ? bikes.find((b) => b.driverId === d.id) : undefined;
  return [
    {
      kind: "text",
      name: "name",
      label: "Name",
      required: true,
      defaultValue: d.name,
      maxLength: 80,
    },
    {
      kind: "select",
      name: "role",
      label: "Role",
      required: true,
      options: STAFF_ROLE_OPTIONS,
      defaultValue: d.role ?? "DRIVER",
      width: "sm",
    },
    {
      kind: "select",
      name: "bikeId",
      label: "Bike",
      options: bikes.map((b) => ({
        value: b.id,
        label: b.driver && b.driverId !== d.id ? `${b.name} (now ${b.driver.name})` : b.name,
      })),
      placeholder: "No bike",
      defaultValue: current?.id ?? null,
      hint:
        bikes.length === 0
          ? "Add bikes under Settings → Bikes first."
          : "The bike this driver rides. A bike shown with another name moves to this driver.",
      showWhen: { field: "role", value: "DRIVER" },
    },
    {
      kind: "text",
      name: "phone",
      label: "Phone",
      type: "tel",
      defaultValue: d.phone,
      width: "sm",
    },
    {
      kind: "text",
      name: "monthlySalary",
      label: "Monthly salary (PKR)",
      required: true,
      inputMode: "decimal",
      defaultValue: d.monthlySalary,
      width: "sm",
    },
    {
      kind: "text",
      name: "joiningDate",
      label: "Joining date",
      type: "date",
      defaultValue: d.joiningDate,
      width: "sm",
    },
  ];
}
