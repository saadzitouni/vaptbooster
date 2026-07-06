// Session guards for server components / actions.
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Require a logged-in member and return their tenantId (redirects otherwise). */
export async function requireTenantId(): Promise<string> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.tenantId) redirect("/operator");
  return session.user.tenantId;
}

/**
 * Require a logged-in member and return both userId and tenantId in one call
 * (avoids a second auth() + non-null assertion in write actions).
 */
export async function requireTenantUser(): Promise<{
  userId: string;
  tenantId: string;
}> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.tenantId) redirect("/operator");
  return { userId: session.user.id, tenantId: session.user.tenantId };
}

/** Require an operator session (redirects otherwise). */
export async function requireOperator() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "operator") redirect("/dashboard");
  return session.user;
}
