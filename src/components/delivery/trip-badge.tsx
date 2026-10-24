import { Badge } from "@/components/ui/badge";
import { TRIP_STATUS_LABEL } from "@/lib/delivery";

export function TripStatusBadge({ status }: { status: keyof typeof TRIP_STATUS_LABEL }) {
  return (
    <Badge variant={status === "PLANNED" || status === "DISPATCHED" ? "secondary" : "outline"}>
      {TRIP_STATUS_LABEL[status]}
    </Badge>
  );
}

/** "62 / 90 dz", marked when over the bike's capacity. */
export function LoadText({ load, capacity }: { load: number; capacity: number }) {
  const over = load > capacity;
  return (
    <span className={over ? "text-destructive font-semibold" : undefined}>
      {load / 2} / {capacity / 2} dz{over ? " (over capacity)" : ""}
    </span>
  );
}
