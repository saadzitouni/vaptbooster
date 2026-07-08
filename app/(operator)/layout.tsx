import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { auth } from "@/auth";
import { getNotifications } from "@/lib/queries";

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "operator") redirect("/dashboard");

  const operator = {
    name: session.user.name ?? session.user.email ?? "Operator",
    email: session.user.email ?? "",
  };

  const notifications = await getNotifications({
    id: session.user.id,
    role: session.user.role,
    tenantId: session.user.tenantId ?? null,
  });

  return (
    <div className="flex min-h-screen">
      <Sidebar variant="operator" />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={operator} notifications={notifications} />
        <main className="flex-1 px-6 md:px-10 py-8 md:py-10 max-w-[1280px] w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
