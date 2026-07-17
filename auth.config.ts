// =============================================================
// Edge-safe auth config.
//
// This half contains NO Node-only imports (no Prisma, no bcrypt),
// so it can run in the middleware (edge runtime). It holds route
// protection + the jwt/session shaping. The Credentials provider —
// which needs Prisma + bcrypt — lives in the Node-only auth.ts.
// =============================================================

import type { NextAuthConfig } from "next-auth";

// Tenant-scoped route prefixes (the (tenant) route group).
const TENANT_PREFIXES = [
  "/dashboard",
  "/scans",
  "/findings",
  "/assets",
  "/reports",
  "/settings",
];

function isOperatorPath(pathname: string): boolean {
  return pathname === "/operator" || pathname.startsWith("/operator/");
}

function isTenantPath(pathname: string): boolean {
  return TENANT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    // Route-level authorization, evaluated in middleware for every request.
    authorized({ auth, request: { nextUrl } }) {
      const { pathname } = nextUrl;
      const user = auth?.user;
      const isLoggedIn = !!user;
      const role = user?.role;

      const isAuthPage = pathname === "/login" || pathname === "/forgot";
      const isOperatorRoute = isOperatorPath(pathname);
      const isTenantRoute = isTenantPath(pathname);
      const isProtected = isOperatorRoute || isTenantRoute;

      // Already-authenticated users shouldn't sit on the login screen.
      if (isAuthPage) {
        if (isLoggedIn) {
          const dest = role === "operator" ? "/operator" : "/dashboard";
          return Response.redirect(new URL(dest, nextUrl));
        }
        return true;
      }

      if (isProtected) {
        if (!isLoggedIn) return false; // → redirect to signIn page (/login)

        // Role gating: operators own /operator/*, everyone else owns tenant pages.
        if (isOperatorRoute && role !== "operator") {
          return Response.redirect(new URL("/dashboard", nextUrl));
        }
        if (isTenantRoute && role === "operator") {
          return Response.redirect(new URL("/operator", nextUrl));
        }
        return true;
      }

      // Non-protected paths (/, etc.) — allow; server components decide.
      return true;
    },

    // Persist identity + tenant into the JWT at sign-in.
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.tenantId = user.tenantId;
        token.tenantSlug = user.tenantSlug;
      }
      return token;
    },

    // Expose the extra fields on the session object.
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as "operator" | "admin" | "member";
        session.user.tenantId = (token.tenantId as string | null) ?? null;
        session.user.tenantSlug = (token.tenantSlug as string | null) ?? null;
      }
      return session;
    },
  },
  providers: [], // real providers added in auth.ts (Node runtime)
} satisfies NextAuthConfig;
