import Link from "next/link";

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

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="mb-2 text-sm">
      <Link href={href} className="text-muted-foreground hover:text-foreground">
        ← {children}
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
