"use client";

import { useActionState } from "react";

import { TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";

/** Settings → Cloud sync → Restore: the cloud database to bring back, and a typed confirmation. */
export function CloudRestoreForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="space-y-3">
      <TextField
        state={state}
        name="url"
        label="Connection string of the cloud copy"
        type="password"
        autoComplete="off"
        required
        placeholder="postgresql://user:password@host/dbname?sslmode=require"
      />
      <TextField
        state={state}
        name="confirm"
        label="Type RESTORE to confirm"
        autoComplete="off"
        required
        hint="All data on this computer is replaced by the cloud copy."
      />
      <FormMessage state={state} />
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "Restoring… (this can take a few minutes)" : "Restore from the cloud"}
      </Button>
    </form>
  );
}
