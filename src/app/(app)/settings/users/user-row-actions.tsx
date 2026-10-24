"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { idleState } from "@/lib/action-state";

import { changeRoleAction, resetPasswordAction, setActiveAction } from "./actions";
import { ROLE_OPTIONS } from "./role-options";
import { TemporaryPasswordNotice } from "./temporary-password-notice";

type Props = {
  userId: string;
  name: string;
  role: "OWNER" | "ACCOUNTANT" | "STAFF";
  isActive: boolean;
};

function confirmSubmit(message: string) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    if (!window.confirm(message)) event.preventDefault();
  };
}

export function UserRowActions({ userId, name, role, isActive }: Props) {
  const [roleState, roleAction, rolePending] = useActionState(changeRoleAction, idleState);
  const [activeState, activeAction, activePending] = useActionState(setActiveAction, idleState);
  const [resetState, resetAction, resetPending] = useActionState(resetPasswordAction, idleState);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={roleAction} className="flex items-center gap-1">
          <input type="hidden" name="userId" value={userId} />
          <label htmlFor={`role-${userId}`} className="sr-only">
            Role for {name}
          </label>
          <NativeSelect id={`role-${userId}`} name="role" defaultValue={role} className="h-8 w-40">
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" size="sm" variant="outline" disabled={rolePending}>
            Save role
          </Button>
        </form>

        <form
          action={activeAction}
          onSubmit={confirmSubmit(
            isActive ? `Deactivate ${name}? They will be signed out.` : `Reactivate ${name}?`,
          )}
        >
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="active" value={isActive ? "false" : "true"} />
          <Button type="submit" size="sm" variant="outline" disabled={activePending}>
            {isActive ? "Deactivate" : "Reactivate"}
          </Button>
        </form>

        {isActive ? (
          <form
            action={resetAction}
            onSubmit={confirmSubmit(
              `Give ${name} a new temporary password? Their current password stops working.`,
            )}
          >
            <input type="hidden" name="userId" value={userId} />
            <Button type="submit" size="sm" variant="outline" disabled={resetPending}>
              Reset password
            </Button>
          </form>
        ) : null}
      </div>
      <FormMessage state={roleState} />
      <FormMessage state={activeState} />
      <FormMessage state={resetState} />
      {resetState.status === "success" && resetState.data ? (
        <TemporaryPasswordNotice {...resetState.data} />
      ) : null}
    </div>
  );
}
