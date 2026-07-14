import Link from "next/link";
import { withOperator } from "@/lib/db";
import { Panel } from "@/components/ui/Panel";
import { AcceptInviteForm } from "@/components/settings/AcceptInviteForm";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // The token is the authorization gate — look it up with operator privilege
  // (the visitor is unauthenticated). RLS-bypassing read of a single row.
  const invite = await withOperator((db) =>
    db.invite.findUnique({
      where: { token },
      select: {
        email: true,
        acceptedAt: true,
        expiresAt: true,
        tenantId: true,
        role: true,
        tenant: { select: { name: true } },
      },
    })
  ).catch(() => null);

  const now = Date.now();
  const invalid = !invite
    ? "This invite link is invalid."
    : invite.acceptedAt
    ? "This invite has already been used."
    : invite.expiresAt.getTime() < now
    ? "This invite link has expired."
    : !invite.tenantId || invite.role === "operator"
    ? "This invite can't be accepted here."
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="w-2 h-2 bg-fg rounded-[1px]" />
          <span className="text-[14px] font-medium leading-none">pwntrol</span>
          <span className="text-fg-mute text-[13px]">/</span>
          <span className="text-fg-2 text-[13px]">vaptbooster</span>
        </div>

        <Panel>
          {invalid ? (
            <div className="p-6">
              <div className="eyebrow mb-2">invite</div>
              <h1 className="text-lg font-medium mb-2">Can&apos;t use this link</h1>
              <p className="text-[13px] text-fg-2">{invalid}</p>
              <Link
                href="/login"
                className="inline-block mt-5 text-2xs font-mono text-fg-mute hover:text-fg"
              >
                ← back to sign in
              </Link>
            </div>
          ) : (
            <div className="p-6">
              <div className="eyebrow mb-2">you&apos;re invited</div>
              <h1 className="text-lg font-medium leading-snug mb-1">
                Join <span className="em-sm">{invite!.tenant?.name ?? "the workspace"}</span>
              </h1>
              <p className="text-[13px] text-fg-2 mb-5">
                Set up your account for{" "}
                <span className="font-mono text-fg">{invite!.email}</span>.
              </p>
              <AcceptInviteForm token={token} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
