"use client";

import { useActionState } from "react";

import { FieldError, FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fieldError, idleState, submittedValue } from "@/lib/action-state";

import { inviteUserAction } from "./actions";
import { ROLE_OPTIONS } from "./role-options";
import { TemporaryPasswordNotice } from "./temporary-password-notice";

export function InviteUserForm() {
  const [state, action, pending] = useActionState(inviteUserAction, idleState);
  const nameError = fieldError(state, "name");
  const emailError = fieldError(state, "email");

  return (
    <div className="space-y-4">
      {/* Remount after success so the fields clear. */}
      <form
        key={state.status === "success" ? state.data?.email : "form"}
        action={action}
        className="grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end"
      >
        <div className="space-y-2">
          <Label htmlFor="invite-name">Name</Label>
          <Input
            id="invite-name"
            name="name"
            required
            defaultValue={submittedValue(state, "name")}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "invite-name-error" : undefined}
          />
          <FieldError id="invite-name-error" message={nameError} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            defaultValue={submittedValue(state, "email")}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "invite-email-error" : undefined}
          />
          <FieldError id="invite-email-error" message={emailError} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <NativeSelect
            id="invite-role"
            name="role"
            defaultValue={submittedValue(state, "role") ?? "STAFF"}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add user"}
        </Button>
      </form>
      <FormMessage state={state} />
      {state.status === "success" && state.data ? (
        <TemporaryPasswordNotice {...state.data} />
      ) : null}
    </div>
  );
}
