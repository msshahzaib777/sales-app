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
