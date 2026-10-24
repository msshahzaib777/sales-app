"use client";

import { useState, useTransition } from "react";

import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";

/** A button that asks "are you sure?" and then runs a server action. */
export function ConfirmAction({
  action,
  label,
  confirm,
}: {
  action: () => Promise<ActionState>;
  label: string;
  confirm: string;
}) {
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          window.confirm(confirm) && startTransition(async () => setState(await action()))
        }
      >
        {label}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}
