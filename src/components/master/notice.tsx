const NOTICES: Record<string, string> = {
  saved: "Saved.",
  deleted: "Deleted.",
  posted: "Posted.",
  booked: "Order booked.",
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
export function Notice({ notice }: { notice?: string | string[] }) {
  const text = typeof notice === "string" ? NOTICES[notice] : undefined;
  if (!text) return null;
  return (
    <p role="status" className="mb-4 rounded-md border px-3 py-2 text-sm font-medium">
      {text}
    </p>
  );
}
