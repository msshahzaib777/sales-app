// Phone numbers are Pakistani and always stored as "+92 " and the national number without its
// leading 0: "0300-1234567", "300 1234567", "+92 300 1234567" and "0092 3001234567" all become
// "+92 3001234567"; a landline "042-37001122" becomes "+92 4237001122". One form means searching
// and matching a customer by phone always works. Shared by forms, the server and the seed.

const PREFIX = "+92 ";

/** National digits (no country code, no leading 0) of what was typed, or null if not a number. */
function nationalDigits(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  let d = trimmed.replace(/\D/g, "");
  if (d.startsWith("0092")) d = d.slice(4);
  else if (d.startsWith("92") && d.length >= 11) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  else if (trimmed.startsWith("+")) return null; // another country
  return d;
}

/** "+92 3001234567", or null when it is not a Pakistani number (9 to 11 digits after +92). */
export function normalizePkPhone(text: string): string | null {
  const d = nationalDigits(text);
  return d && /^[1-9]\d{8,10}$/.test(d) ? PREFIX + d : null;
}

/**
 * The digits to look for in stored numbers when a search word looks like (part of) a phone
 * number: "0300-123" → "300123". Null when the word is not number-like.
 */
export function phoneSearchDigits(word: string): string | null {
  if (!/^[+\d][\d\-]{3,}$/.test(word)) return null;
  // A partial number keeps its digits; only a prefix that cannot be part of one is dropped.
  const d = word
    .replace(/\D/g, "")
    .replace(/^(0092|0)/, "")
    .replace(word.startsWith("+92") ? /^92/ : /^$/, "");
  return d.length >= 3 ? d : null;
}

/** A stored "+92 3001234567" as it is usually typed, "03001234567", for matching in pickers. */
export function localPhone(phone: string | null | undefined): string | null {
  return phone?.startsWith(PREFIX) ? `0${phone.slice(PREFIX.length)}` : (phone ?? null);
}
