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
  /** No "All" option. */
  required?: boolean;
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
  showStatus = true,
  showSearch = true,
  dateRange,
  allOption = "All",
}: {
  basePath: string;
  params: Pick<ListParams, "q" | "status">;
  filters?: FilterConfig[];
  searchPlaceholder?: string;
  /** The Active / Deactivated filter of master-data lists. */
  showStatus?: boolean;
  showSearch?: boolean;
  /** Adds From / To date inputs (transaction lists). */
  dateRange?: { from?: string; to?: string; label?: string };
  /** First option of each filter. */
  allOption?: string;
}) {
  return (
    <form
      method="get"
      action={basePath}
      role="search"
      className="mb-4 flex flex-wrap items-end gap-2"
    >
      {showSearch ? (
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
      ) : null}
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
            {filter.required ? null : <option value="">{allOption}</option>}
            {filter.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ))}
      {dateRange ? (
        <>
          <div className="space-y-1">
            <label htmlFor="filter-from" className="text-muted-foreground text-xs font-medium">
              {dateRange.label ?? "Date"} from
            </label>
            <Input
              id="filter-from"
              name="from"
              type="date"
              defaultValue={dateRange.from ?? ""}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="filter-to" className="text-muted-foreground text-xs font-medium">
              to
            </label>
            <Input
              id="filter-to"
              name="to"
              type="date"
              defaultValue={dateRange.to ?? ""}
              className="w-40"
            />
          </div>
        </>
      ) : null}
      {showStatus ? (
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
      ) : null}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
      <Button asChild variant="ghost">
        <Link href={basePath}>Clear</Link>
      </Button>
    </form>
  );
}
