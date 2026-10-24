"use client";

import { useRef } from "react";

/**
 * Idempotency for create forms (CLAUDE.md rule 7): returns a function that adds the same
 * client-generated `requestId` to every submit of this form instance, so pressing Save again after
 * a timeout never creates a second record. Remount the form (new `key`) to start a new record.
 */
export function useRequestId() {
  const id = useRef<string | null>(null);
  return (formData: FormData) => {
    id.current ??= crypto.randomUUID();
    formData.set("requestId", id.current);
    return formData;
  };
}
