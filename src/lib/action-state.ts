// Result of a form server action, shared by server actions and the client forms that show it.

export type ActionState<T = undefined> =
  | { status: "idle" }
  | { status: "success"; message?: string; data?: T }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
      /** What the user typed (never passwords), so the form can show it again after React resets it. */
      values?: Record<string, string>;
    };

export const idleState: ActionState<never> = { status: "idle" };

export function fieldError(state: ActionState<unknown>, field: string): string | undefined {
  return state.status === "error" ? state.fieldErrors?.[field]?.[0] : undefined;
}

/** The value the user typed in `field` before a failed submit, for `defaultValue`. */
export function submittedValue(state: ActionState<unknown>, field: string): string | undefined {
  return state.status === "error" ? state.values?.[field] : undefined;
}

/** Text fields of a form submission, without passwords. */
export function echoValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && !/password/i.test(key) && !key.startsWith("$ACTION"))
      values[key] = value;
  }
  return values;
}
