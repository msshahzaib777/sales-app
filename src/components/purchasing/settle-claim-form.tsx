"use client";

import { useActionState } from "react";

import { FieldError, FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";

/**
 * Settles a day-end damage claim with the company: accept it in full, accept the amount typed, or
 * reject it. The button pressed sends the decision.
 */
export function SettleClaimForm({
  action,
  number,
  claimed,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  number: number;
  claimed: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  if (state.status === "success") return <FormMessage state={state} />;
  const amountError = fieldError(state, "amount");
  return (
    <form action={formAction} className="w-56 space-y-1.5">
      <label htmlFor={`settle-${number}`} className="text-muted-foreground text-xs">
        Amount the company accepted
      </label>
      <Input
        id={`settle-${number}`}
        name="amount"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={claimed}
        aria-invalid={amountError ? true : undefined}
        aria-describedby={amountError ? `settle-${number}-error` : undefined}
        className="h-8"
      />
      <FieldError id={`settle-${number}-error`} message={amountError} />
      <Input
        name="note"
        placeholder="Note (optional)"
        aria-label={`Note for claim #${number}`}
        className="h-8"
        maxLength={300}
      />
      <div className="flex flex-wrap gap-1.5">
        <Button type="submit" name="decision" value="ACCEPT_LESS" size="sm" disabled={pending}>
          Accept
        </Button>
        <Button
          type="submit"
          name="decision"
          value="REJECT"
          size="sm"
          variant="outline"
          disabled={pending}
        >
          Reject
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
