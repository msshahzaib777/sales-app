"use client";

import { useSearchParams } from "next/navigation";

export function PasswordChangedNotice() {
  const params = useSearchParams();
  const message =
    params.get("passwordChanged") === "1"
      ? "Password changed. Sign in with your new password."
      : params.get("restored") === "1"
        ? "The data was restored from the cloud copy. Sign in with your usual email and password."
        : null;
  if (!message) return null;
  return (
    <p role="status" className="mb-4 rounded-md border p-3 text-sm">
      {message}
    </p>
  );
}
