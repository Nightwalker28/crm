import { createHmac } from "node:crypto";

// Mirrors backend/app/modules/user_management/services/mfa.py: base32 secret, SHA1, 6 digits,
// 30-second period. Implemented with node:crypto so authenticated e2e runs need no extra package.
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(secret: string) {
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  if (!normalized) {
    throw new Error("The TOTP secret is empty.");
  }

  const bytes: number[] = [];
  let value = 0;
  let bits = 0;

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error(
        `The TOTP secret contains ${character}, which is not base32. Use the setup key your authenticator app showed at enrollment, not the 6-digit code.`,
      );
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

/** Seconds remaining before the current code rolls over. */
export function secondsUntilNextTotpWindow(atSeconds: number = Date.now() / 1000) {
  return PERIOD_SECONDS - (atSeconds % PERIOD_SECONDS);
}

export function generateTotpCode(secret: string, atSeconds: number = Date.now() / 1000) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atSeconds / PERIOD_SECONDS)));

  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}
