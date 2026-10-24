"use client";

import { useActionState } from "react";

import { FieldError, FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";

/** Adds an expense category. */
export function CategoryForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const error = fieldError(state, "name");
  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <div className="space-y-1">
        <label htmlFor="category-name" className="sr-only">
          New category
        </label>
        <Input
          // Empty again after each category added.
          key={state.status === "success" ? state.message : "new"}
          id="category-name"
          name="name"
          placeholder="New category, e.g. Tea and food"
          maxLength={60}
          className="w-72"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "category-name-error" : undefined}
        />
        <FieldError id="category-name-error" message={error} />
      </div>
      <Button type="submit" disabled={pending}>
        Add category
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
