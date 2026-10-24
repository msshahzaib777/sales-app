"use client";

import { useActionState } from "react";

import { FieldError, FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";

export function DueDateForm({
  action,
  dueDate,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  dueDate: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="dueDate" className="text-sm font-medium">
          Due date
        </label>
        <Input
          id="dueDate"
          name="dueDate"
          type="date"
          defaultValue={dueDate}
          required
          className="w-44"
        />
        <FieldError id="dueDate-error" message={fieldError(state, "dueDate")} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Change due date
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
