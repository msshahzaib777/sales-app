import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServiceError } from "@/server/services/errors";

/** Loads a record for a page; "not found" (including another tenant's id) becomes a 404. */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
}

export function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="secondary">Active</Badge>
  ) : (
    <Badge variant="outline">Deactivated</Badge>
  );
}

export function LinkButton({
  href,
  children,
  variant = "default",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "outline";
}) {
  return (
    <Button asChild variant={variant}>
      <Link href={href}>{children}</Link>
    </Button>
  );
}

export function EditLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="font-medium underline-offset-4 hover:underline"
      aria-label={`Edit ${label}`}
    >
      {label}
    </Link>
  );
}
