import type { ActionState } from "@/lib/action-state";

/** Success or error line under a form. Announced to screen readers. */
export function FormMessage({ state }: { state: ActionState<unknown> }) {
  if (state.status === "idle") return null;
  if (state.status === "error") {
    return (
      <p role="alert" className="text-destructive text-sm font-medium">
        {state.message}
      </p>
    );
  }
  return state.message ? (
    <p role="status" className="text-sm font-medium">
      {state.message}
    </p>
  ) : null;
}

export function FieldError({ message, id }: { message?: string; id: string }) {
  return message ? (
    <p id={id} className="text-destructive text-sm">
      {message}
    </p>
  ) : null;
}
