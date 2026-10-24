import "server-only";

import { ZodError } from "zod";

import { ForbiddenError } from "./auth/permissions";
import { type ActionState, echoValues } from "@/lib/action-state";

import { ServiceError } from "./services/errors";

/**
 * Runs an action body and turns expected failures (validation, permission, business rules) into a
 * form error. Anything else, including Next.js redirects, is re-thrown. Pass the form data to
 * echo the typed values back on error (passwords are never echoed).
 */
export async function runAction<T>(
  body: () => Promise<{ message?: string; data?: T } | void>,
  formData?: FormData,
): Promise<ActionState<T>> {
  const values = formData ? echoValues(formData) : undefined;
  try {
    const result = await body();
    return { status: "success", ...(result ?? {}) };
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "form";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return {
        status: "error",
        message: "Please check the highlighted fields.",
        fieldErrors,
        values,
      };
    }
    if (error instanceof ServiceError) return { status: "error", message: error.message, values };
    if (error instanceof ForbiddenError)
      return { status: "error", message: "You do not have permission to do this." };
    throw error;
  }
}
