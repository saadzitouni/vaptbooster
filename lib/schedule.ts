// =============================================================
// Scan-schedule timing — shared by the web actions (set nextRunAt on create)
// and the worker's cron tick (advance after firing). No external deps: all
// timezone math is done with the built-in Intl API.
//
// worker/src/schedule.ts keeps a byte-for-byte copy of computeNextRunAt (the
// worker is a separate build and can't import from here) — change both together.
// =============================================================

export type Frequency = "daily" | "weekly" | "monthly";

export type ScheduleSpec = {
  frequency: Frequency;
  hour: number; // 0-23, local to `timezone`
  minute: number; // 0-59
  dayOfWeek: number | null; // 0=Sun..6=Sat — weekly only
  dayOfMonth: number | null; // 1-28 — monthly only
  timezone: string; // IANA, e.g. "Africa/Algiers"
};

const DAY_MS = 86_400_000;
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Milliseconds the given timezone is ahead of UTC at `utcMs`.
function offsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== "literal") m[p.type] = p.value;
  let hour = Number(m.hour);
  if (hour === 24) hour = 0; // some engines render midnight as "24"
  const asLocal = Date.UTC(+m.year, +m.month - 1, +m.day, hour, +m.minute, +m.second);
  return asLocal - utcMs;
}

// The UTC instant for a wall-clock time in `tz`. One correction pass handles
// DST transitions for every non-ambiguous time (the only edge is the ~1h/year
// skipped/repeated hour, immaterial for scan scheduling).
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off1 = offsetMs(guess, tz);
  const corrected = guess - off1;
  const off2 = offsetMs(corrected, tz);
  return off2 === off1 ? corrected : guess - off2;
}

function localCal(utcMs: number, tz: string): { y: number; mo: number; d: number; wd: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== "literal") m[p.type] = p.value;
  return { y: +m.year, mo: +m.month, d: +m.day, wd: WD[m.weekday] ?? 0 };
}

/**
 * The next UTC instant strictly after `fromMs` that matches the schedule's
 * local-time rule. Walks forward a calendar day at a time (≤400 iterations),
 * so it is correct across DST shifts and short months.
 */
export function computeNextRunAt(spec: ScheduleSpec, fromMs: number = Date.now()): Date {
  const base = localCal(fromMs, spec.timezone);
  // Noon-UTC anchor of the local start date — stepping by whole days from here
  // never skips or doubles a calendar day.
  const anchor = Date.UTC(base.y, base.mo - 1, base.d, 12);
  for (let i = 0; i < 400; i++) {
    const { y, mo, d, wd } = localCal(anchor + i * DAY_MS, spec.timezone);
    const match =
      spec.frequency === "daily"
        ? true
        : spec.frequency === "weekly"
          ? wd === spec.dayOfWeek
          : d === spec.dayOfMonth;
    if (!match) continue;
    const cand = wallToUtc(y, mo, d, spec.hour, spec.minute, spec.timezone);
    if (cand > fromMs) return new Date(cand);
  }
  return new Date(fromMs + DAY_MS); // unreachable fallback
}

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DOW_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Human summary, e.g. "Weekly on Monday at 09:00 (Africa/Algiers)". */
export function describeSchedule(spec: ScheduleSpec): string {
  const t = `${String(spec.hour).padStart(2, "0")}:${String(spec.minute).padStart(2, "0")}`;
  const when =
    spec.frequency === "daily"
      ? "Daily"
      : spec.frequency === "weekly"
        ? `Weekly on ${DOW_LABEL[spec.dayOfWeek ?? 0]}`
        : `Monthly on the ${ordinal(spec.dayOfMonth ?? 1)}`;
  return `${when} at ${t} (${spec.timezone})`;
}
