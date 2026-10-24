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
