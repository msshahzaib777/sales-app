import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toDateInput } from "@/lib/dates";

/** From / to (and optional extra fields) for a statement; never printed. */
export function StatementRangeForm({
  range,
  children,
}: {
  range: { from?: Date; to?: Date };
  children?: React.ReactNode;
}) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2 print:hidden">
      {children}
      <div className="space-y-1">
        <label htmlFor="from" className="text-muted-foreground text-xs font-medium">
          From
        </label>
        <Input
          id="from"
          name="from"
          type="date"
          defaultValue={range.from ? toDateInput(range.from) : ""}
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="to" className="text-muted-foreground text-xs font-medium">
          To
        </label>
        <Input
          id="to"
          name="to"
          type="date"
          defaultValue={range.to ? toDateInput(range.to) : ""}
          className="w-40"
        />
      </div>
      <Button type="submit" variant="secondary">
        Show
      </Button>
    </form>
  );
}
