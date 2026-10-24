"use client";

import { useActionState } from "react";

import { FieldError, FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldError, idleState } from "@/lib/action-state";
import { changePasswordAction } from "@/server/auth/actions";

const FIELDS = [
  { name: "currentPassword", label: "Current password", autoComplete: "current-password" },
  { name: "newPassword", label: "New password", autoComplete: "new-password" },
  { name: "confirmPassword", label: "Repeat new password", autoComplete: "new-password" },
] as const;

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, idleState);
  const busy = pending;

  return (
    <form action={action} className="space-y-4">
      {FIELDS.map((field, index) => {
        const error = fieldError(state, field.name);
        return (
          <div key={field.name} className="space-y-2">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              id={field.name}
              name={field.name}
              type="password"
              autoComplete={field.autoComplete}
              required
              autoFocus={index === 0}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${field.name}-error` : undefined}
            />
            <FieldError id={`${field.name}-error`} message={error} />
          </div>
        );
      })}
      <p className="text-muted-foreground text-xs">
        At least 8 characters, with a letter and a number.
      </p>
      <FormMessage state={state} />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
