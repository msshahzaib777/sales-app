"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/form/form-message";
import { useFullReloadOnSuccess } from "@/components/layout/full-reload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState, submittedValue } from "@/lib/action-state";
import { loginAction } from "@/server/auth/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, idleState);
  useFullReloadOnSuccess(state, "/dashboard");
  const busy = pending || state.status === "success";

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          defaultValue={submittedValue(state, "email")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <FormMessage state={state} />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
