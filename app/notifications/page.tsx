import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getNotifications } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

const TONE: Record<string, string> = {
  finding_critical: "bg-crit",
  scan_failed: "bg-crit",
  scan_completed: "bg-ok",
  scan_approved: "bg-ok",
  scan_rejected: "bg-warn",
  message: "bg-info",
};

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { items } = await getNotifications({
    id: session.user.id,
    role: session.user.role,
    tenantId: session.user.tenantId ?? null,
  });
  const back = session.user.role === "operator" ? "/operator" : "/dashboard";

  return (
    <div className="min-h-screen bg-ink text-fg">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <Link href={back} className="text-2xs text-fg-mute font-mono hover:text-fg">
          ← back
        </Link>
        <h1 className="text-[28px] font-medium tracking-tight mt-4 mb-8">Notifications</h1>

        {items.length === 0 ? (
          <p className="text-fg-mute text-sm">No notifications yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((n) => {
              const inner = (
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", TONE[n.type] ?? "bg-fg-mute")} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-fg leading-snug">{n.title}</div>
                    {n.body && <div className="text-[13px] text-fg-2 mt-1 whitespace-pre-wrap">{n.body}</div>}
                    <div className="text-2xs text-fg-mute font-mono mt-1.5">{timeAgo(n.createdAt)}</div>
                  </div>
                </div>
              );
              return (
                <li
                  key={n.id}
                  className={cn(
                    "border rounded-lg transition-colors",
                    n.readAt ? "border-line bg-ink" : "border-line-2 bg-ink-2/50"
                  )}
                >
                  {n.link ? (
                    <Link href={n.link} className="block hover:bg-ink-2">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
