import { Badge } from "@/components/ui/badge";
import { CHEQUE_STATUS_LABEL } from "@/lib/payments";

export const METHOD_LABEL = { CASH: "Cash", CHEQUE: "Cheque", ONLINE: "Online" } as const;

/** Reversed / cheque status, nothing for an ordinary posted payment. */
export function PaymentBadges({
  status,
  chequeStatus,
}: {
  status: "POSTED" | "REVERSED";
  chequeStatus?: keyof typeof CHEQUE_STATUS_LABEL | null;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {chequeStatus ? (
        <Badge
          variant={
            chequeStatus === "BOUNCED"
              ? "destructive"
              : chequeStatus === "PENDING"
                ? "secondary"
                : "outline"
          }
        >
          Cheque {CHEQUE_STATUS_LABEL[chequeStatus].toLowerCase()}
        </Badge>
      ) : null}
      {status === "REVERSED" && chequeStatus !== "BOUNCED" ? (
        <Badge variant="outline">Reversed</Badge>
      ) : null}
    </span>
  );
}
