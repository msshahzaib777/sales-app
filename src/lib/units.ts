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
