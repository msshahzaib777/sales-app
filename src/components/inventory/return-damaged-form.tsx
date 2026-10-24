"use client";

import { useActionState } from "react";

import { TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";

/** Sends damaged stock back to the company: it leaves the damaged bucket; no money moves. */
export function ReturnDamagedForm({
  action,
  today,
  damaged,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  today: string;
  damaged: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  return (
    <form
      action={(fd) => formAction(withRequestId(fd))}
      className="max-w-3xl space-y-3 rounded-lg border p-4"
    >
      <p className="text-sm">
        <span className="font-medium">Send damaged stock back to the company</span>{" "}
        <span className="text-muted-foreground">
          ({damaged} damaged now). The company was already credited by the damage claim, so only
          stock moves.
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField state={state} name="quantity" label="Dozens" inputMode="decimal" required />
        <TextField
          state={state}
          name="returnDate"
          label="Date"
          type="date"
          required
          defaultValue={today}
        />
        <TextField
          state={state}
          name="note"
          label="Note"
          maxLength={300}
          className="sm:col-span-2"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Send back"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
