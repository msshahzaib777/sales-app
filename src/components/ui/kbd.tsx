import { cn } from "@/lib/utils";

/**
 * A keyboard shortcut written next to its action ("Alt+N", "Esc"), so it can be read and learnt.
 * Hidden on touch screens and in print; aria-hidden because the control itself carries
 * aria-keyshortcuts, so screen readers announce it once.
 */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "rounded border border-current/25 px-1 font-sans text-[0.7rem] leading-4 font-normal whitespace-nowrap opacity-70 print:hidden pointer-coarse:hidden",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
