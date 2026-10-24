const NOTICES: Record<string, string> = {
  saved: "Saved.",
  deleted: "Deleted.",
};

/** One-line confirmation after a redirect (?notice=saved). */
export function Notice({ notice }: { notice?: string | string[] }) {
  const text = typeof notice === "string" ? NOTICES[notice] : undefined;
  if (!text) return null;
  return (
    <p role="status" className="mb-4 rounded-md border px-3 py-2 text-sm font-medium">
      {text}
    </p>
  );
}
