"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Shows a one-time password so the owner can pass it on. It is not stored and won't be shown again. */
export function TemporaryPasswordNotice({
  email,
  temporaryPassword,
}: {
  email: string;
  temporaryPassword: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = `Sales App sign-in\nEmail: ${email}\nTemporary password: ${temporaryPassword}`;

  return (
    <div role="status" className="border-foreground/80 space-y-2 rounded-md border-2 p-3 text-sm">
      <p className="font-medium">
        Share these details with the user. The password is shown only once.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Email</dt>
        <dd>{email}</dd>
        <dt className="text-muted-foreground">Temporary password</dt>
        <dd className="font-mono text-base tracking-wide">{temporaryPassword}</dd>
      </dl>
      <p className="text-muted-foreground">
        They will be asked to choose their own password after signing in.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy for WhatsApp"}
      </Button>
    </div>
  );
}
