"use client";

import { useActionState } from "react";

import { TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";

/** Adds one unpaid paper bill from before the app to the customer's old balance. */
export function OldBillForm({
  action,
  today,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  return (
    <form action={(fd) => formAction(withRequestId(fd))} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <TextField
          state={state}
          name="billDate"
          label="Bill date"
          type="date"
          required
          defaultValue={today}
        />
        <TextField
          state={state}
          name="billNo"
          label="Bill number"
          hint="If the paper bill has one"
          maxLength={30}
        />
        <TextField
          state={state}
          name="amount"
          label="Unpaid amount"
          inputMode="decimal"
          autoComplete="off"
          required
        />
        <TextField state={state} name="note" label="Note" maxLength={200} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add old bill"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
