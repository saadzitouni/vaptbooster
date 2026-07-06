// =============================================================
// Full NextAuth setup (Node runtime).
//
// Adds the Credentials provider — which needs Prisma + bcrypt —
// on top of the edge-safe authConfig. Imported by the API route
// handler and by server components via auth().
// =============================================================

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { withOperator } from "@/lib/db";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/password";
import { rateLimitAllow } from "@/lib/rate-limit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .toLowerCase()
          .trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        // Brute-force guard: cap failed attempts per account (fails open if
        // Redis is down, so a limiter outage never locks out real users).
        const allowed = await rateLimitAllow(`login:${email}`, 10, 15 * 60);
        if (!allowed) return null;

        // Look up the user in operator context — at login time there is
        // no tenant context yet, and operators have tenantId = null, so we
        // must bypass RLS to find the account by email.
        const user = await withOperator((db) =>
          db.user.findUnique({
            where: { email },
            include: { tenant: true },
          })
        );

        // Always run a bcrypt compare (against a dummy hash if the account
        // is absent) so a missing user and a wrong password take the same
        // time — no user enumeration by login timing.
        const ok = await verifyPassword(
          password,
          user?.passwordHash ?? DUMMY_PASSWORD_HASH
        );
        if (!user || !user.passwordHash || !ok) return null;

        // Best-effort last-login stamp (don't block sign-in on failure).
        try {
          await withOperator((db) =>
            db.user.update({
              where: { id: user.id },
              data: { lastLogin: new Date() },
            })
          );
        } catch {
          // ignore
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId ?? null,
          tenantSlug: user.tenant?.slug ?? null,
        };
      },
    }),
  ],
});
