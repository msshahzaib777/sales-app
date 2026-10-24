"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";
import { LIST_PATHS } from "@/lib/master-paths";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import { createArea, updateArea } from "./services/master/areas";
import { createBike, updateBike } from "./services/master/bikes";
import {
  deleteRecord,
  MASTER_ENTITIES,
  type MasterEntity,
  setRecordActive,
} from "./services/master/common";
import { createCompany, updateCompany } from "./services/master/companies";
import { createCustomer, updateCustomer } from "./services/master/customers";
import { commitImport, type ImportPreview, previewImport } from "./services/master/import";
import type { ImportKind } from "./services/master/import-rows";
import { createProduct, updateProduct } from "./services/master/products";
import { createStaff, updateStaff } from "./services/master/staff";
import { createWarehouse, updateWarehouse } from "./services/master/warehouses";
import { ServiceError } from "./services/errors";

// Server actions for master-data forms. Each re-checks the session and permission, then calls the
// service (which validates, checks permissions again and writes the audit log).

/** Plain form fields (no Next.js internals). */
function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

type Saver = (
  ctx: Awaited<ReturnType<typeof requireTenantContext>>,
  id: string | null,
  formData: FormData,
) => Promise<unknown>;

const SAVERS: Record<MasterEntity, Saver> = {
  Warehouse: (ctx, id, fd) =>
    id ? updateWarehouse(ctx, id, fields(fd)) : createWarehouse(ctx, fields(fd)),
  Area: (ctx, id, fd) => (id ? updateArea(ctx, id, fields(fd)) : createArea(ctx, fields(fd))),
  Company: (ctx, id, fd) =>
    id ? updateCompany(ctx, id, fields(fd)) : createCompany(ctx, fields(fd)),
  Bike: (ctx, id, fd) => (id ? updateBike(ctx, id, fields(fd)) : createBike(ctx, fields(fd))),
  Staff: (ctx, id, fd) => (id ? updateStaff(ctx, id, fields(fd)) : createStaff(ctx, fields(fd))),
  Product: (ctx, id, fd) => {
    const from = fd.getAll("slabFrom").map(String);
    const value = fd.getAll("slabValue").map(String);
    const slabs = from
      .map((f, i) => ({ fromDozens: f, value: value[i] ?? "" }))
      .filter((s) => s.fromDozens.trim() !== "" || s.value.trim() !== "");
    const input = { ...fields(fd), slabs };
    return id ? updateProduct(ctx, id, input) : createProduct(ctx, input);
  },
  Customer: (ctx, id, fd) => {
    const all = fields(fd);
    const openingBalances: Record<string, string> = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith("opening:")) openingBalances[key.slice("opening:".length)] = value;
    }
    const input = { ...all, openingBalances };
    return id ? updateCustomer(ctx, id, input) : createCustomer(ctx, input);
  },
};

function assertEntity(entity: string): asserts entity is MasterEntity {
  if (!(MASTER_ENTITIES as string[]).includes(entity))
    throw new ServiceError("Unknown record type.");
}

/** Create (id = null) or update a master record, then return to the list (or a new blank form). */
export async function saveRecordAction(
  entity: MasterEntity,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let savedId = "";
  const result = await runAction<undefined>(async () => {
    assertEntity(entity);
    const ctx = await requireTenantContext("masterData.manage");
    const saved = (await SAVERS[entity](ctx, id, formData)) as { id: string };
    savedId = saved.id;
  }, formData);
  if (result.status !== "success") return result;
  const list = LIST_PATHS[entity];
  revalidatePath(list);
  // `last` gives the next blank form a new key, so it starts with a fresh request id.
  redirect(
    formData.get("intent") === "new"
      ? `${list}/new?notice=saved&last=${savedId}`
      : `${list}?notice=saved`,
  );
}

export async function setActiveAction(
  entity: MasterEntity,
  id: string,
  isActive: boolean,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    assertEntity(entity);
    const ctx = await requireTenantContext("masterData.manage");
    await setRecordActive(ctx, entity, { id }, isActive);
    return {
      message: isActive ? "Reactivated." : "Deactivated. It no longer appears in pick lists.",
    };
  });
  if (result.status === "success") revalidatePath(LIST_PATHS[entity]);
  return result;
}

export async function deleteRecordAction(entity: MasterEntity, id: string): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    assertEntity(entity);
    const ctx = await requireTenantContext("masterData.manage");
    await deleteRecord(ctx, entity, { id });
  });
  if (result.status !== "success") return result;
  revalidatePath(LIST_PATHS[entity]);
  redirect(`${LIST_PATHS[entity]}?notice=deleted`);
}

// ───────────────────────── Import ─────────────────────────

async function uploadedFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new ServiceError("Choose a file to import.");
  return { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) };
}

const IMPORT_KINDS: ImportKind[] = ["products", "customers"];

export async function importPreviewAction(
  kind: ImportKind,
  _prev: ActionState<ImportPreview>,
  formData: FormData,
): Promise<ActionState<ImportPreview>> {
  return runAction(async () => {
    if (!IMPORT_KINDS.includes(kind)) throw new ServiceError("Unknown import.");
    const ctx = await requireTenantContext("masterData.manage");
    return { data: await previewImport(ctx, kind, await uploadedFile(formData)) };
  });
}

export async function importCommitAction(
  kind: ImportKind,
  _prev: ActionState<{ created: number; updated: number; skipped: number }>,
  formData: FormData,
): Promise<ActionState<{ created: number; updated: number; skipped: number }>> {
  const result = await runAction(async () => {
    if (!IMPORT_KINDS.includes(kind)) throw new ServiceError("Unknown import.");
    const ctx = await requireTenantContext("masterData.manage");
    const requestId = String(formData.get("requestId") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(requestId))
      throw new ServiceError("Refresh the page and try again.");
    const counts = await commitImport(ctx, kind, await uploadedFile(formData), requestId);
    const parts = [
      counts.created ? `${counts.created} added` : null,
      counts.updated ? `${counts.updated} updated` : null,
      counts.skipped
        ? `${counts.skipped} ${counts.skipped === 1 ? "row" : "rows"} with errors skipped`
        : null,
    ].filter(Boolean);
    return { message: `Import finished: ${parts.join(", ") || "nothing changed"}.`, data: counts };
  });
  if (result.status === "success") revalidatePath(kind === "products" ? "/products" : "/customers");
  return result;
}
