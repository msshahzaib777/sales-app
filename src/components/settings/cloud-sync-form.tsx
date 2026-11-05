"use client";

import { useActionState } from "react";

import { TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";

/** The cloud database's connection string (kept on this computer only, never shown again). */
export function CloudSyncForm({
  action,
  enabled,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  enabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="space-y-3">
      <TextField
        state={state}
        name="url"
        label="Connection string"
        type="password"
        autoComplete="off"
        required
        placeholder="postgresql://user:password@host/dbname?sslmode=require"
        hint="Saved on this computer only. It is never shown again."
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending
          ? "Checking the cloud database…"
          : enabled
            ? "Save and use it"
            : "Check and turn on"}
      </Button>
    </form>
  );
}
