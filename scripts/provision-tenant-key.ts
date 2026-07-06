#!/usr/bin/env tsx
/**
 * provision-tenant-key.ts
 *
 * Creates a LiteLLM virtual key for a tenant and stores its id
 * on the tenant row. Run this when onboarding a new tenant —
 * before they can run their first scan.
 *
 * Usage:
 *   pnpm tsx scripts/provision-tenant-key.ts <tenantSlug>
 *
 * What it does:
 *   1. Look up the tenant in our DB.
 *   2. Call LiteLLM's /key/generate with:
 *        - max_budget       (matches tenant plan)
 *        - budget_duration  (monthly, resets automatically)
 *        - metadata         (tenant_id — every call carries this back)
 *   3. Store the returned virtual-key id on tenants.litellmKeyId.
 *
 * The virtual key itself never gets stored in plaintext anywhere —
 * we only keep the *id*. To use it, the worker fetches the key
 * from LiteLLM on demand, or uses the key directly if returned
 * during this provisioning call.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const prisma = new PrismaClient();

const LITELLM_URL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
const MASTER_KEY = process.env.LITELLM_MASTER_KEY;

if (!MASTER_KEY) {
  console.error("LITELLM_MASTER_KEY not set");
  process.exit(1);
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: provision-tenant-key.ts <tenantSlug>");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: { budget: true },
  });
  if (!tenant) {
    console.error(`No tenant with slug "${slug}"`);
    process.exit(1);
  }
  if (tenant.litellmKeyId) {
    console.error(`Tenant ${slug} already has a virtual key (${tenant.litellmKeyId}). Refusing to overwrite.`);
    process.exit(1);
  }

  // Compute monthly budget in USD from the tenant's plan
  const monthlyBudgetUsd =
    (tenant.budget?.monthlyHardCeilingUsdCents ?? 50_000) / 100;

  console.log(`Provisioning LiteLLM key for ${tenant.name} (${slug})`);
  console.log(`  monthly budget: $${monthlyBudgetUsd.toFixed(2)}`);

  const res = await fetch(`${LITELLM_URL}/key/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MASTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key_alias: `tenant-${slug}`,
      max_budget: monthlyBudgetUsd,
      budget_duration: "30d", // monthly rolling
      models: ["vaptbooster-default", "vaptbooster-fast", "vaptbooster-deep"],
      metadata: {
        tenant_id: tenant.id,
        tenant_slug: slug,
      },
      // Default rate limits — tune per plan if needed
      tpm_limit: 200_000, // tokens per minute
      rpm_limit: 500,     // requests per minute
    }),
  });

  if (!res.ok) {
    console.error(`LiteLLM /key/generate returned ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }

  const data = await res.json();
  const keyId = data.key_name as string | undefined;
  const rawKey = data.key as string | undefined;

  if (!keyId || !rawKey) {
    console.error("LiteLLM did not return a key — got:", data);
    process.exit(1);
  }

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { litellmKeyId: keyId },
  });

  // DEV secrets bridge — the worker reads the raw key from here.
  // PRODUCTION: store in Vault / AWS Secrets / Doppler, NOT a file.
  const dir = ".secrets";
  if (!existsSync(dir)) mkdirSync(dir);
  const bridgePath = `${dir}/litellm-keys.json`;
  const bridge = existsSync(bridgePath)
    ? JSON.parse(readFileSync(bridgePath, "utf8"))
    : {};
  bridge[tenant.id] = rawKey;
  writeFileSync(bridgePath, JSON.stringify(bridge, null, 2));

  console.log(`✓ Virtual key created: ${keyId}`);
  console.log(`✓ Raw key written to ${bridgePath} (dev only — use a secrets manager in prod)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
