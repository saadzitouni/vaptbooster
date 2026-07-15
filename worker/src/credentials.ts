// Worker-side counterpart to lib/scan-credentials.ts — decrypt the encrypted
// scan credentials and format an "auth brief" for the agent's system prompt.
// Same algorithm + key derivation as the web side (shared AUTH_SECRET).
import { createDecipheriv, createHash } from "crypto";

export type ScanCreds = {
  loginUrl?: string;
  username?: string;
  password?: string;
  authHeader?: string;
  notes?: string;
};

function key(): Buffer {
  const secret =
    process.env.SCAN_CREDS_KEY ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "vaptbooster-insecure-fallback";
  return createHash("sha256").update(secret).digest();
}

export function decryptScanCreds(blob: string | null | undefined): ScanCreds | null {
  if (!blob) return null;
  try {
    const [v, ivb, tagb, encb] = blob.split(".");
    if (v !== "v1" || !ivb || !tagb || !encb) return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivb, "base64url"));
    d.setAuthTag(Buffer.from(tagb, "base64url"));
    const json = Buffer.concat([
      d.update(Buffer.from(encb, "base64url")),
      d.final(),
    ]).toString("utf8");
    return JSON.parse(json) as ScanCreds;
  } catch {
    return null;
  }
}

// Turn creds into the AUTHENTICATED TESTING block injected into the agent's
// prompt. Returns "" when there's nothing usable.
export function buildAuthBrief(c: ScanCreds | null): string {
  if (!c) return "";
  const lines: string[] = [];
  if (c.loginUrl) lines.push(`- Login URL: ${c.loginUrl}`);
  if (c.username) lines.push(`- Username: ${c.username}`);
  if (c.password) lines.push(`- Password: ${c.password}`);
  if (c.authHeader) lines.push(`- Send this auth header/cookie on requests: ${c.authHeader}`);
  if (c.notes) lines.push(`- Notes from the client: ${c.notes}`);
  if (!lines.length) return "";
  return `=== AUTHENTICATED TESTING (authorized test account provided) ===
You have valid credentials for an AUTHORIZED test account on this target. Authenticate FIRST, then spend most of your budget on the AUTHENTICATED surface — that is where access-control, IDOR, privilege-escalation, and business-logic bugs live. Establish a session (cookies / token) and reuse it across requests. Do NOT brute-force or lock the account. Use these credentials ONLY against the in-scope target; ignore any blank field.
${lines.join("\n")}`;
}
