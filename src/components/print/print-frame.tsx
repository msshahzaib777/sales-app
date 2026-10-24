import { BackLink } from "@/components/layout/page-header";
import { PrintButton } from "@/components/layout/print-button";
import type { PrintProfile } from "@/server/services/settings";

/** Page CSS for printing (from src/lib/print.ts). */
export function PrintStyles({ css }: { css: string }) {
  return <style>{css}</style>;
}

/** Name, logo, address and phone of the business; just the name when nothing else is set. */
export function Letterhead({
  business,
  right,
}: {
  business: PrintProfile["business"];
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-black pb-2">
      <div className="flex items-start gap-3">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL; next/image adds nothing here
          <img
            src={business.logoUrl}
            alt=""
            className="h-[3.2em] w-auto max-w-[10em] object-contain"
          />
        ) : null}
        <div>
          <p className="text-[1.3em] leading-tight font-bold">{business.name}</p>
          {business.address ? <p>{business.address}</p> : null}
          {business.phone ? <p>{business.phone}</p> : null}
        </div>
      </div>
      {right ? <div className="text-right">{right}</div> : null}
    </header>
  );
}

/** Back link, print button and paper hint; never printed. */
export function PrintToolbar({
  back,
  children,
  hint,
}: {
  back: { href: string; label: string };
  children?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <PrintButton />
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
    </div>
  );
}
