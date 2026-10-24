"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/action-state";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import { ServiceError } from "./services/errors";
import { setLogo, updateBusinessSettings } from "./services/settings";

// Settings → Business & printing. Each action re-checks the session; the service checks the
// permission again, validates and writes the audit log.

export async function saveBusinessSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireTenantContext("settings.manage");
    const input: Record<string, string> = {};
    for (const [key, value] of formData)
      if (typeof value === "string" && !key.startsWith("$ACTION")) input[key] = value;
    await updateBusinessSettings(ctx, input);
    revalidatePath("/", "layout");
    return { message: "Settings saved." };
  }, formData);
}

export async function uploadLogoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireTenantContext("settings.manage");
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new ServiceError("Choose an image file.");
    await setLogo(ctx, { bytes: new Uint8Array(await file.arrayBuffer()) });
    revalidatePath("/", "layout");
    return { message: "Logo uploaded." };
  });
}

export async function removeLogoAction(_prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireTenantContext("settings.manage");
    await setLogo(ctx, null);
    revalidatePath("/", "layout");
    return { message: "Logo removed." };
  });
}
