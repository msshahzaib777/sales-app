import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/sales";

export function OrderStatusBadge({
  status,
  needsCreditApproval,
}: {
  status: OrderStatus;
  needsCreditApproval?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant={status === "BOOKED" || status === "PLANNED" ? "secondary" : "outline"}>
        {ORDER_STATUS_LABEL[status]}
      </Badge>
      {needsCreditApproval ? <Badge variant="destructive">Needs owner approval</Badge> : null}
    </span>
  );
}
