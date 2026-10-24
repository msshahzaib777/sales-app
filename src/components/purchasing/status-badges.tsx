import { Badge } from "@/components/ui/badge";
import { dueText } from "@/server/services/purchasing/calc";

const PO_LABEL: Record<string, string> = {
  OPEN: "Open",
  PARTIALLY_RECEIVED: "Partly received",
  RECEIVED: "Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export function PurchaseOrderBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "OPEN" || status === "PARTIALLY_RECEIVED" ? "secondary" : "outline"}>
      {PO_LABEL[status] ?? status}
    </Badge>
  );
}

/** Paid / Partial / Unpaid / Overdue, with "due N days ago". Readable in black and white. */
export function BillStatusBadge({
  state,
}: {
  state: { status: string; overdue: boolean; daysOverdue: number };
}) {
  if (state.status === "REVERSED") return <Badge variant="outline">Cancelled</Badge>;
  if (state.status === "PAID") return <Badge variant="outline">Paid</Badge>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {state.overdue ? <Badge variant="destructive">Overdue</Badge> : null}
      <Badge variant="secondary">{state.status === "PARTIAL" ? "Partial" : "Unpaid"}</Badge>
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {dueText(state.daysOverdue)}
      </span>
    </span>
  );
}

export function PostingBadge({ status }: { status: string }) {
  return status === "POSTED" ? null : (
    <Badge variant="outline">{status === "REVERSED" ? "Cancelled" : status}</Badge>
  );
}
