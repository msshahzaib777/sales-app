import Link from "next/link";

import { Kbd } from "@/components/ui/kbd";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  /** Buttons shown at the right, e.g. "New customer". */
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** Back to the page above; Esc goes there too (components/layout/keyboard-shortcuts). */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="mb-2 text-sm">
      <Link
        href={href}
        data-back-link
        aria-keyshortcuts="Escape"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
      >
        ← {children}
        <Kbd>Esc</Kbd>
      </Link>
    </p>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
      {children}
    </div>
  );
}
