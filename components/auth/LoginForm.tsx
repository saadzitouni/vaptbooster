"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Input, Field } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (!res || res.error) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    // "/" routes to /operator or /dashboard based on role.
    router.push("/");
    router.refresh();
  }

  return (
    <form className="mt-8 flex flex-col gap-4" onSubmit={onSubmit}>
      {error && (
        <div className="border border-crit/40 text-crit rounded px-3.5 py-2.5 text-2xs font-mono">
          {error}
        </div>
      )}

      <Field label="Email" required>
        <Input
          type="email"
          name="email"
          placeholder="you@yourcompany.com"
          required
          autoComplete="email"
        />
      </Field>

      <Field label="Password" required>
        <Input
          type="password"
          name="password"
          placeholder="••••••••••"
          required
          autoComplete="current-password"
        />
      </Field>

      <div className="flex items-center justify-between text-2xs font-mono">
        <label className="flex items-center gap-2 text-fg-2 cursor-pointer">
          <input type="checkbox" name="remember" className="accent-fg" />
          Remember me
        </label>
        <a href="/forgot" className="text-fg-2 hover:text-fg">
          Forgot password?
        </a>
      </div>

      <Button
        type="submit"
        variant="solid"
        size="lg"
        className="mt-3 justify-center"
        disabled={loading}
      >
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
