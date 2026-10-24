"use client";

import { useEffect } from "react";

import type { ActionState } from "@/lib/action-state";

/** After a successful sign-in/out, load `href` from scratch (see src/server/auth/actions.ts). */
export function useFullReloadOnSuccess(state: ActionState<unknown>, href: string) {
  useEffect(() => {
    if (state.status === "success") window.location.assign(href);
  }, [state, href]);
}
