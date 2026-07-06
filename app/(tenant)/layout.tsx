import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { auth } from "@/auth";
import { withTenant } from "@/lib/db";

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "operator") redirect("/operator");

  // Resolve the real tenant for this user (RLS-scoped read — proves the
  // tenant-aware DB path works end-to-end from the app).
  const tenantId = session.user.tenantId;
  const tenant = tenantId
    ? await withTenant(tenantId, (db) => db.tenant.findFirst())
    : null;

  const user = {
    name: session.user.name ?? session.user.email ?? "User",
    email: session.user.email ?? "",
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar
        variant="tenant"
        tenantName={tenant?.name ?? session.user.tenantSlug ?? "—"}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} tenantSlug={tenant?.slug ?? session.user.tenantSlug ?? undefined} />
        <main className="flex-1 px-6 md:px-10 py-8 md:py-10 max-w-[1280px] w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
