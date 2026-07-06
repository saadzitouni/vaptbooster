import Link from "next/link";
import { Input, Field } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function ForgotPasswordPage() {
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
          <div className="eyebrow mb-4">// account recovery</div>
          <h1 className="text-[42px] leading-tight tracking-tight2 font-medium">
            Lost your <span className="em">way</span>?<br />
            We'll get you <span className="em">back in</span>.
          </h1>
          <p className="mt-6 text-fg-2 max-w-md text-[15px]">
            Enter the email your invitation was sent to and we'll send a secure
            link to reset your password.
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
            Reset <span className="em">password</span>.
          </h2>
          <p className="mt-2 text-fg-2 text-[14px]">
            We'll email you a link to set a new one.
          </p>

          <form className="mt-8 flex flex-col gap-4">
            <Field label="Email" required>
              <Input
                type="email"
                name="email"
                placeholder="you@yourcompany.com"
                required
                autoComplete="email"
              />
            </Field>

            <Button variant="solid" size="lg" className="mt-3 justify-center">
              Send reset link
            </Button>
          </form>

          <p className="mt-10 text-2xs text-fg-mute font-mono leading-relaxed">
            Remembered it?{" "}
            <Link href="/login" className="text-fg-2 hover:text-fg">
              Back to sign in
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
