// Quantities are stored as integers in the smallest unit (half dozen). See CLAUDE.md rule 4.
// Conversion to dozens happens only for display.

export const HALF_DOZENS_PER_DOZEN = 2;

/** Formats a half-dozen quantity for display, e.g. 7 -> "3.5 dz". */
export function formatDozens(halfDozens: number): string {
  if (!Number.isInteger(halfDozens)) {
    throw new Error(`Quantity must be an integer number of half dozens, got ${halfDozens}`);
  }
  const dozens = halfDozens / HALF_DOZENS_PER_DOZEN;
  return `${Number.isInteger(dozens) ? dozens : dozens.toFixed(1)} dz`;
}

/** Converts a dozen value entered by a user (whole or .5) to half dozens. */
export function dozensToHalfDozens(dozens: number): number {
  const halfDozens = dozens * HALF_DOZENS_PER_DOZEN;
  if (!Number.isInteger(halfDozens)) {
    throw new Error(`Quantity must be a multiple of half a dozen, got ${dozens}`);
  }
  return halfDozens;
}
