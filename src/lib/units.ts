// Quantities are stored as integers in the smallest unit: the packet (12 packets = 1 dozen). See
// CLAUDE.md rule 4. Orders and purchases are in whole or half dozens; damage and returns can be any
// number of packets. Conversion to dozens happens only for display. Rates are per dozen.

export const PACKETS_PER_DOZEN = 12;
export const PACKETS_PER_HALF_DOZEN = PACKETS_PER_DOZEN / 2;

/**
 * Formats a packet quantity for display: whole and half dozens as "3.5 dz", anything else as
 * dozens and packets, e.g. 41 → "3 dz 5 pk", 5 → "5 pk".
 */
export function formatDozens(packets: number): string {
  if (!Number.isInteger(packets)) {
    throw new Error(`Quantity must be an integer number of packets, got ${packets}`);
  }
  if (packets % PACKETS_PER_HALF_DOZEN === 0) {
    const dozens = packets / PACKETS_PER_DOZEN;
    return `${Number.isInteger(dozens) ? dozens : dozens.toFixed(1)} dz`;
  }
  const sign = packets < 0 ? "-" : "";
  const abs = Math.abs(packets);
  const dozens = Math.floor(abs / PACKETS_PER_DOZEN);
  const rest = abs % PACKETS_PER_DOZEN;
  return `${sign}${dozens ? `${dozens} dz ` : ""}${rest} pk`;
}

/** Splits packets into whole dozens and the packets left over, e.g. 41 → { dozens: 3, packets: 5 }. */
export function splitPackets(packets: number): { dozens: number; packets: number } {
  return {
    dozens: Math.trunc(packets / PACKETS_PER_DOZEN),
    packets: packets % PACKETS_PER_DOZEN,
  };
}

/** Converts a dozen value entered by a user (whole or .5) to packets. */
export function dozensToPackets(dozens: number): number {
  const halves = dozens * 2;
  if (!Number.isInteger(halves)) {
    throw new Error(`Quantity must be a multiple of half a dozen, got ${dozens}`);
  }
  return halves * PACKETS_PER_HALF_DOZEN;
}

/** For a column headed "Dz": "3.5" for whole and half dozens, "3 dz 5 pk" otherwise. */
export function formatDozensCell(packets: number): string {
  return packets % PACKETS_PER_HALF_DOZEN === 0
    ? formatDozens(packets).replace(" dz", "")
    : formatDozens(packets);
}

/**
 * Reads a quantity typed in any of the ways people write it, into packets. A plain number is
 * dozens; packets only with "pk":
 *   "12" and "12.5" (dozens), "12dz 4pk", "12 dz 4 pk", "12dz4" and "12 dz 4" (the number after
 *   dozens is packets), "4pk". Units: dz / doz / dozen / d, pk / pkt / pack / packet / p.
 * Returns null when it can't be read, or when it is not a whole number of packets.
 */
export function parseQuantity(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, "");
  if (t === "") return null;
  const m = t.match(
    /^(?:(\d+(?:\.\d+)?)\s*(dz|doz|dozens?|d)(?![a-z])\.?)?\s*(?:(\d+(?:\.\d+)?)\s*(pk|pkts?|packs?|packets?|p)?(?![a-z])\.?)?$/,
  );
  if (!m || (m[1] === undefined && m[3] === undefined)) return null;
  const [, dz, , rest, restUnit] = m;
  let packets = 0;
  if (dz !== undefined) packets += Number(dz) * PACKETS_PER_DOZEN;
  if (rest !== undefined) {
    // On its own a bare number is dozens; after dozens ("12dz 4") it is packets.
    const inDozens = !restUnit && dz === undefined;
    packets += Number(rest) * (inDozens ? PACKETS_PER_DOZEN : 1);
  }
  // Floating point: 12.25 dz is 147 packets, not 146.99999.
  const rounded = Math.round(packets * 1e6) / 1e6;
  return Number.isInteger(rounded) && rounded <= 99_999_999 ? rounded : null;
}

/** "= 12 dz 4 pk" under a quantity box, or null while it can't be read. */
export function quantityHint(text: string): string | null {
  const packets = parseQuantity(text);
  return packets === null || packets === 0 ? null : `= ${formatDozens(packets)}`;
}

/** A packet quantity as text that parseQuantity reads back, e.g. 148 → "12dz 4pk", 144 → "12". */
export function quantityText(packets: number): string {
  const dz = Math.trunc(packets / PACKETS_PER_DOZEN);
  const pk = packets % PACKETS_PER_DOZEN;
  if (pk === 0) return String(dz);
  return dz ? `${dz}dz ${pk}pk` : `${pk}pk`;
}
