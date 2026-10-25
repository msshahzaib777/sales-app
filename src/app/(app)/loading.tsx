/**
 * Shown at once when moving to another page while its data loads, so clicks feel instant (and the
 * page streams in instead of blocking the navigation).
 */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="bg-muted h-8 w-56 animate-pulse rounded-md" />
      <div className="bg-muted h-4 w-80 animate-pulse rounded-md" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-muted h-40 animate-pulse rounded-lg" />
        <div className="bg-muted h-40 animate-pulse rounded-lg" />
      </div>
    </div>
  );
}