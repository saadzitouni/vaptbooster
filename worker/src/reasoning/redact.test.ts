// Redaction unit test (acceptance criterion: no token/PII/card-shaped number in
// a reasoning payload). Run: `npx tsx src/reasoning/redact.test.ts` from worker/.
import assert from "node:assert";
import { redact, redactDeep } from "./redact.js";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSIsImFjY291bnQiOiJCIn0.s3cr3t-Signature_XyZ012";
const CARD = "4111111111111111"; // 16 digits
const CARD_SPACED = "4111 1111 1111 1111";

// 1. Flat strings
assert.ok(!redact(`Authorization: Bearer ${JWT}`).includes(JWT), "JWT leaked (header)");
assert.ok(!redact(`card on file ${CARD}`).includes(CARD), "card leaked");
assert.ok(!redact(`card ${CARD_SPACED} exp`).includes("4111"), "spaced card leaked");
assert.ok(!redact("contact pentest@acme.io").includes("pentest@acme.io"), "email leaked");

// 2. Deep redaction of a realistic TEST payload
const payload = {
  steps: [
    {
      method: "GET",
      path: "/api/orders/1198",
      headerNote: `Authorization: Bearer ${JWT}`,
      response: { status: 200, summary: `account_id: B · card ${CARD} · a@b.com`, expected: false },
    },
  ],
};
const s = JSON.stringify(redactDeep(payload));
assert.ok(!s.includes(JWT), "JWT leaked (deep)");
assert.ok(!s.includes(CARD), "card leaked (deep)");
assert.ok(!s.includes("a@b.com"), "email leaked (deep)");
// Non-sensitive structure survives
assert.ok(s.includes("/api/orders/1198"), "path was wrongly redacted");
assert.ok(s.includes("account_id: B"), "benign summary was wrongly redacted");

console.log("✓ redact test passed");
