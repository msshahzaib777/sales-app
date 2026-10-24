import type { MasterEntity } from "@/server/services/master/common";

/** Where each master record's list lives. */
export const LIST_PATHS: Record<MasterEntity, string> = {
  Warehouse: "/settings/warehouses",
  Area: "/settings/areas",
  Company: "/companies",
  Product: "/products",
  Customer: "/customers",
  Bike: "/settings/bikes",
  Staff: "/settings/staff",
};
