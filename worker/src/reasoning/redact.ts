// =============================================================
// Redaction — the single choke point for reasoning-event payloads. Every string
// that could carry a token, credential, PII, or card-shaped number is scrubbed
// here before the event is persisted or streamed. Conservative by design: it is
// better to over-redact a reasoning line than to leak a secret to the UI/DB.
// =============================================================

const PATTERNS: { re: RegExp; label: string }[] = [
  // JWT: three base64url segments starting with the standard header prefix.
  { re: /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, label: "jwt" },
  // Authorization scheme values (Bearer/Basic/Token <value>).
  { re: /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._\-+/=]{6,}/gi, label: "token" },
  // Common provider key shapes.
  { re: /\b(?:sk|pk|rk)_[A-Za-z0-9]{10,}/g, label: "key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "key" },
  { re: /\bghp_[A-Za-z0-9]{20,}/g, label: "key" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, label: "key" },
  { re: /\bAIza[0-9A-Za-z_-]{20,}/g, label: "key" },
  // key=value / key: value secrets (password, secret, token, api_key, cookie…).
  {
    re: /\b(?:pass(?:word)?|secret|token|api[_-]?key|authorization|cookie|session)\s*[=:]\s*[^\s&"';]{4,}/gi,
    label: "secret",
  },
  // 13–19 digit card-shaped numbers (optional space/dash separators).
  { re: /\b\d(?:[ -]?\d){12,18}\b/g, label: "card" },
  // Email addresses (PII).
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, label: "email" },
];

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { re, label } of PATTERNS) out = out.replace(re, `‹${label} redacted›`);
  return out;
}

// Recursively redact every string in an object/array (used on the whole payload).
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as unknown as T;
  }
  return value;
}
