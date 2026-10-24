import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ListParams } from "@/lib/list-params";

export type FilterConfig = {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
};

/**
 * Search + filters as a plain GET form: works without JavaScript, keeps filters in the URL so
 * lists can be bookmarked, and Enter in the search box applies everything.
 */
export function ListToolbar({
  basePath,
  params,
  filters = [],
  searchPlaceholder = "Search",
}: {
  basePath: string;
  params: ListParams;
  filters?: FilterConfig[];
  searchPlaceholder?: string;
}) {
  return (
    <form
      method="get"
      action={basePath}
      role="search"
      className="mb-4 flex flex-wrap items-end gap-2"
    >
      <div className="min-w-48 flex-1 space-y-1">
        <label htmlFor="q" className="text-muted-foreground text-xs font-medium">
          Search
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={params.q ?? ""}
          placeholder={searchPlaceholder}
        />
      </div>
      {filters.map((filter) => (
        <div key={filter.name} className="space-y-1">
          <label
            htmlFor={`filter-${filter.name}`}
            className="text-muted-foreground text-xs font-medium"
          >
            {filter.label}
          </label>
          <NativeSelect
            id={`filter-${filter.name}`}
            name={filter.name}
            defaultValue={filter.value ?? ""}
            className="w-44"
          >
            <option value="">All</option>
            {filter.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ))}
      <div className="space-y-1">
        <label htmlFor="filter-status" className="text-muted-foreground text-xs font-medium">
          Status
        </label>
        <NativeSelect
          id="filter-status"
          name="status"
          defaultValue={params.status}
          className="w-32"
        >
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
          <option value="all">All</option>
        </NativeSelect>
      </div>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
      <Button asChild variant="ghost">
        <Link href={basePath}>Clear</Link>
      </Button>
    </form>
  );
}
