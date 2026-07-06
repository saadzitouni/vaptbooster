// Next.js server instrumentation hook. Initializes Sentry only when
// SENTRY_DSN is set AND @sentry/nextjs is installed — so observability is
// opt-in and the app runs fine without it.
//
// To enable: `npm i @sentry/nextjs` and set SENTRY_DSN in the environment.
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // Variable specifier so TS/bundler doesn't hard-require the package.
    const pkg = "@sentry/nextjs";
    const Sentry = (await import(/* webpackIgnore: true */ pkg)) as {
      init: (opts: Record<string, unknown>) => void;
    };
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    });
    console.log("[observability] Sentry initialized");
  } catch {
    console.warn(
      "[observability] SENTRY_DSN is set but @sentry/nextjs is not installed — run: npm i @sentry/nextjs"
    );
  }
}
