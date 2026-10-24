import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

/** Hashes a password with scrypt. Format: `scrypt$N$r$p$saltBase64$hashBase64`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(
    password.normalize("NFKC"),
    Buffer.from(saltB64, "base64"),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: PARAMS.maxmem,
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// No 0/O, 1/l/I, so it can be read out over the phone or typed from WhatsApp without mistakes.
const TEMP_LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const TEMP_DIGITS = "23456789";

/** A one-time password for an invited user or a reset, e.g. "kXm4-p7Qa-Rt3z". */
export function generateTemporaryPassword(): string {
  const all = TEMP_LETTERS + TEMP_DIGITS;
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => all[b % all.length]!);
  // Guarantee at least one letter and one digit (the password policy).
  chars[0] = TEMP_LETTERS[bytes[0]! % TEMP_LETTERS.length]!;
  chars[5] = TEMP_DIGITS[bytes[5]! % TEMP_DIGITS.length]!;
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((g) => g.join(""))
    .join("-");
}
