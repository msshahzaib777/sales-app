"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/auth/actions";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await logoutAction();
          // Full load: drops every page cached for this user (shared office PCs).
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point: it drops the client cache between users
          window.location.assign("/login");
        })
      }
    >
      <LogOut aria-hidden />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
