import Link from "next/link";

/** Previous / next links that keep the current filters. */
export function Pagination({
  basePath,
  searchParams,
  page,
  pageCount,
  total,
}: {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  page: number;
  pageCount: number;
  total: number;
}) {
  const href = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key !== "page" && key !== "notice" && typeof value === "string" && value)
        params.set(key, value);
    }
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  return (
    <nav
      aria-label="Pages"
      className="text-muted-foreground mt-3 flex items-center justify-between text-sm"
    >
      <span>
        {total} {total === 1 ? "record" : "records"}
        {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}
      </span>
      {pageCount > 1 ? (
        <span className="flex gap-3">
          {page > 1 ? (
            <Link href={href(page - 1)} className="underline underline-offset-4">
              Previous
            </Link>
          ) : null}
          {page < pageCount ? (
            <Link href={href(page + 1)} className="underline underline-offset-4">
              Next
            </Link>
          ) : null}
        </span>
      ) : null}
    </nav>
  );
}
