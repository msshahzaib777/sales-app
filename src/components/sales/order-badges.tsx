import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/sales";

export function OrderStatusBadge({
  status,
  needsCreditApproval,
  counter,
}: {
  status: OrderStatus;
  needsCreditApproval?: boolean;
  /** A counter sale (collected at the warehouse). */
  counter?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {counter ? <Badge variant="secondary">Counter</Badge> : null}
      <Badge variant={status === "BOOKED" || status === "PLANNED" ? "secondary" : "outline"}>
        {ORDER_STATUS_LABEL[status]}
      </Badge>
      {needsCreditApproval ? <Badge variant="destructive">Needs owner approval</Badge> : null}
    </span>
  );
}
