import Link from "next/link";

const NOTICES: Record<string, string> = {
  saved: "Saved.",
  deleted: "Deleted.",
  posted: "Posted.",
  booked: "Order booked.",
  sold: "Counter sale saved. Stock is out and the bill is posted to the customer ledger.",
  cancelled: "Order cancelled. Its stock is free again.",
  approved: "Approved past the credit limit.",
  removed: "Removed from the trip. The order is booked again.",
  "trip-planned": "Trip planned. Print the loading sheet and bills, then dispatch.",
  "trip-cancelled": "Trip cancelled. Its orders are booked again.",
  dispatched: "Dispatched. Stock is out and the bills are posted to the customer ledgers.",
  "day-end-saved": "Day-end saved.",
  "day-end-undone":
    "Day-end undone: stock, bill, claims and payments are back as dispatched. Enter it again below.",
  "payment-posted": "Payment posted to the customer ledger.",
  "payment-reversed": "Payment reversed. The customer owes that amount again.",
  "cheque-cleared": "Cheque marked as cleared.",
  unflagged: "Flag removed.",
  "expense-saved": "Expense saved.",
  "adjustment-saved": "Stock adjustment saved.",
  "adjustment-requested": "Stock adjustment sent to the owner for approval.",
  "old-bill-added": "Old bill added to the customer's old balance.",
  "old-bill-removed": "Old bill removed. A reversal is in the customer's ledger.",
  "damaged-returned": "Damaged stock sent back to the company.",
  "cheque-bounced": "Cheque bounced: the payment is reversed and the customer is flagged.",
};

/** One-line confirmation after a redirect (?notice=saved). */
export type NextStep = { href: string; label: string };

/**
 * The message for `?notice=…` after a save, with optional next-step buttons, so the usual next
 * job (print the bill, book the next order…) is one click away.
 */
export function Notice({
  notice,
  text: override,
  next = [],
}: {
  notice?: string | string[];
  /** Replaces the standard message, e.g. to name the saved document. */
  text?: string;
  next?: NextStep[];
}) {
  const known = typeof notice === "string" ? NOTICES[notice] : undefined;
  const text = known ? (override ?? known) : undefined;
  if (!text) return null;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm print:hidden"
    >
      <span className="font-medium">{text}</span>
      {next.length ? (
        <span className="flex flex-wrap gap-2">
          {next.map((step) => (
            <Link
              key={step.href}
              href={step.href}
              className="hover:bg-muted rounded-md border px-2.5 py-1 text-sm font-medium"
            >
              {step.label}
            </Link>
          ))}
        </span>
      ) : null}
    </div>
  );
}
