"use client";

import { useSearchParams } from "next/navigation";

export function PasswordChangedNotice() {
  const params = useSearchParams();
  if (params.get("passwordChanged") !== "1") return null;
  return (
    <p role="status" className="mb-4 rounded-md border p-3 text-sm">
      Password changed. Sign in with your new password.
    </p>
  );
}
