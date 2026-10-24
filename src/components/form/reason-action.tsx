"use client";

import { useActionState, useState } from "react";

import { FieldError, FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";

/** A reversing action (cancel, reverse) that asks for a reason before running. */
export function ReasonAction({
  action,
  label,
  description,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, idleState);
  if (state.status === "success") return <FormMessage state={state} />;
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  const error = fieldError(state, "reason");
  return (
    <form action={formAction} className="max-w-xl space-y-2 rounded-lg border p-3">
      <p className="text-muted-foreground text-sm">{description}</p>
      <label htmlFor="reason" className="text-sm font-medium">
        Reason
      </label>
      <Input
        id="reason"
        name="reason"
        required
        minLength={3}
        maxLength={300}
        autoFocus
        aria-invalid={error ? true : undefined}
      />
      <FieldError id="reason-error" message={error} />
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Working…" : label}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
