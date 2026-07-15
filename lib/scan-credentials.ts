// Test credentials for an authenticated (gray-box) scan. Stored ENCRYPTED on
// the scan (AES-256-GCM) and decrypted only in the worker at run time. The key
// derives from AUTH_SECRET (already required by NextAuth and shared with the
// worker via the same .env), so no new secret is needed.
import { createCipheriv, randomBytes, createHash } from "crypto";

export type ScanCreds = {
  loginUrl?: string;
  username?: string;
  password?: string;
  authHeader?: string; // raw header or cookie, e.g. "Authorization: Bearer …" / "Cookie: session=…"
  notes?: string;
};

function key(): Buffer {
  const secret =
    process.env.SCAN_CREDS_KEY ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "vaptbooster-insecure-fallback";
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

export function hasAnyCred(c: ScanCreds): boolean {
  return !!(c.loginUrl || c.username || c.password || c.authHeader || c.notes);
}

// "v1.<iv>.<tag>.<ciphertext>" — all base64url.
export function encryptScanCreds(creds: ScanCreds): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(creds), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}
