import type { DefaultSession } from "next-auth";

type AppRole = "operator" | "admin" | "member";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
      tenantId: string | null;
      tenantSlug: string | null;
    } & DefaultSession["user"];
  }

  // Shape returned by the Credentials authorize() callback.
  interface User {
    role: AppRole;
    tenantId: string | null;
    tenantSlug: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: AppRole;
    tenantId: string | null;
    tenantSlug: string | null;
  }
}
