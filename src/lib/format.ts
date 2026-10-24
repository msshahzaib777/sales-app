const DEFAULT_TIME_ZONE = "Asia/Karachi";

/** e.g. "24 Oct 2026, 2:15 pm" in the tenant's time zone (PKT by default). */
export function formatDateTime(value: Date | string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

/** PKR amount with thousands separators, e.g. "1,320.50". Accepts Decimal, string or number. */
export function formatMoney(
  value: { toString(): string } | string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "—";
  const [whole = "0", fraction = ""] = value.toString().split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${(fraction + "00").slice(0, 2)}`;
}

type DiscountLike = { discountType: string; discountValue: { toString(): string } | string };

/** "Rs 200/dz", "2%", or "—". */
export function formatDiscount(d: DiscountLike): string {
  if (d.discountType === "NONE") return "—";
  const value = Number(d.discountValue.toString()).toString();
  return d.discountType === "PERCENT" ? `${value}%` : `Rs ${value}/dz`;
}
