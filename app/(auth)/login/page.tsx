import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 border-r border-line bg-ink-2">
        <Link href="https://pwntrol.com" className="flex items-center gap-2.5">
          <span className="w-2 h-2 bg-fg rounded-[1px]" />
          <span className="text-[14px] font-medium">pwntrol</span>
          <span className="text-fg-mute">/</span>
          <span className="text-fg-2">vaptbooster</span>
        </Link>

        <div>
          <div className="eyebrow mb-4">closed beta · cohort #001</div>
          <h1 className="text-[42px] leading-tight tracking-tight2 font-medium">
            Welcome <span className="em">back</span>.<br />
            Let's go <span className="em">hunting</span>.
          </h1>
          <p className="mt-6 text-fg-2 max-w-md text-[15px]">
            VAPTBOOSTER is invite-only. If you don't have credentials yet,{" "}
            <Link href="https://pwntrol.com#engage" className="text-fg underline">
              talk to us
            </Link>
            .
          </p>
        </div>

        <div className="text-2xs text-fg-mute font-mono">
          © 2026 PWNTROL Consultancy FZCO · Dubai, UAE
        </div>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden mb-10">
            <Link href="https://pwntrol.com" className="flex items-center gap-2.5">
              <span className="w-2 h-2 bg-fg rounded-[1px]" />
              <span className="text-[14px] font-medium">pwntrol / vaptbooster</span>
            </Link>
          </div>

          <h2 className="text-[28px] leading-tight tracking-tight2 font-medium">
            Sign <span className="em">in</span>.
          </h2>
          <p className="mt-2 text-fg-2 text-[14px]">
            Use the email your invitation was sent to.
          </p>

          <LoginForm />

          <p className="mt-10 text-2xs text-fg-mute font-mono leading-relaxed">
            By signing in you agree to our{" "}
            <Link href="#" className="text-fg-2 hover:text-fg">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="#" className="text-fg-2 hover:text-fg">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
