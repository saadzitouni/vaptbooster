// =============================================================
// Tenant-aware Prisma client
//
// Every request runs queries inside a transaction that sets
// app.current_tenant and app.role via set_config() (parameterized —
// no string interpolation touches the RLS boundary). Postgres RLS uses
// those settings to filter rows, even if a query forgets a WHERE.
//
// IMPORTANT: the app must connect as the low-privilege `vaptbooster_app`
// role (DATABASE_URL). Superusers/table-owners bypass RLS even with
// FORCE — see scripts/init-db-roles.sql. A runtime guard below warns
// loudly if we ever connect as a superuser.
//
// Usage:
//   const data = await withTenant(tenantId, async (db) => {
//     return db.scan.findMany();           // RLS-isolated, no manual filter
//   });
//   const data = await withOperator(async (db) => {
//     return db.scan.findMany();           // cross-tenant
//   });
// =============================================================

import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __rlsSuperuserChecked: boolean | undefined;
}

const prisma =
  global.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") global.prisma = prisma;

// -------------------------------------------------------------
// Runtime guard: refuse to silently run without RLS. If DATABASE_URL
// points at a superuser, RLS is bypassed and tenant isolation is gone.
// Warn loudly, once per process. (Fire-and-forget — never blocks.)
// -------------------------------------------------------------
if (!global.__rlsSuperuserChecked) {
  global.__rlsSuperuserChecked = true;
  prisma
    .$queryRawUnsafe<{ s: string }[]>("SELECT current_setting('is_superuser') AS s")
    .then((rows) => {
      if (rows?.[0]?.s === "on") {
        console.error(
          "\n[SECURITY] DATABASE_URL connects as a Postgres SUPERUSER — " +
            "Row-Level Security is BYPASSED and tenants are NOT isolated.\n" +
            "Point DATABASE_URL at the low-privilege vaptbooster_app role " +
            "(see scripts/init-db-roles.sql).\n"
        );
      }
    })
    .catch(() => {
      /* connection not ready / permissions — ignore */
    });
}

export { prisma };

// The transaction client exposes the same model API as PrismaClient
// minus the top-level connection/extension methods.
type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Run a callback inside a transaction with the tenant context set.
 * RLS policies isolate every query to this tenant automatically.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TxClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx: TxClient) => {
    // Parameterized — the tenantId value can never break out of the query.
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.current_tenant', $1, true)",
      tenantId
    );
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.role', $1, true)",
      "tenant_user"
    );
    return fn(tx);
  });
}

/**
 * Run a callback as an operator (cross-tenant). RLS is bypassed via the
 * app.role='operator' short-circuit in the policies. Operator actions are
 * privileged — audit-log them in app code.
 */
export async function withOperator<T>(
  fn: (tx: TxClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx: TxClient) => {
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.role', $1, true)",
      "operator"
    );
    return fn(tx);
  });
}
