// =============================================================
// scope-verify.ts — domain-ownership verification for scope targets.
//
// A tenant proves control of a target by publishing a per-target token
// as a DNS TXT record. The token is a deterministic HMAC of the target id
// under the app secret — so we never store it, and it can't be guessed or
// reused across targets/tenants.
//
// SERVER ONLY: uses the app secret + node DNS. Never import from a client
// component (the page computes the record string and passes it down).
// =============================================================
import { createHmac } from "crypto";
import { promises as dns } from "dns";

const SECRET =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret";

export const VERIFY_TXT_PREFIX = "vaptbooster-verification";

/** Deterministic per-target token — no storage required. */
export function verificationToken(targetId: string): string {
  return createHmac("sha256", SECRET)
    .update(`scope:${targetId}`)
    .digest("hex")
    .slice(0, 32);
}

/** The exact TXT record value the tenant must publish. */
export function expectedTxtRecord(targetId: string): string {
  return `${VERIFY_TXT_PREFIX}=${verificationToken(targetId)}`;
}

/** Registrable host from a url/domain scope value (null if not applicable). */
export function hostFromValue(value: string): string | null {
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).hostname || null;
    return value.replace(/^\*\./, "").split("/")[0]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Look up TXT records on the host (root) and on `_vaptbooster.<host>` and
 * return true if any exactly matches the expected token. Either location is
 * accepted so the tenant can pick whichever their DNS provider allows.
 */
export async function checkDnsTxt(host: string, expected: string): Promise<boolean> {
  for (const name of [host, `_vaptbooster.${host}`]) {
    try {
      const records = await dns.resolveTxt(name);
      // Each record is an array of string chunks — join before comparing.
      if (records.map((chunks) => chunks.join("").trim()).includes(expected)) {
        return true;
      }
    } catch {
      // NXDOMAIN / no TXT records at this name — try the next.
    }
  }
  return false;
}
