"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { createSchedule, setScheduleActive, deleteSchedule } from "@/lib/actions/schedules";
import { describeSchedule, type Frequency } from "@/lib/schedule";

type Target = { id: string; value: string; type: string };
type Row = {
  id: string;
  targetValue: string;
  frequency: Frequency;
  hour: number;
  minute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  active: boolean;
  hasCredentials: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastScanId: string | null;
};

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function ScheduleManager({ targets, schedules }: { targets: Target[]; schedules: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Form state
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [time, setTime] = useState("09:00");
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [tz, setTz] = useState("UTC");

  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      /* keep UTC */
    }
  }, []);

  const [hh, mm] = time.split(":");

  function act(fn: () => Promise<unknown>, okText?: string) {
    setMsg(null);
    start(async () => {
      try {
        await fn();
        if (okText) setMsg({ ok: true, text: okText });
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* -------- existing schedules -------- */}
      <Panel>
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <h3 className="text-[13px] font-medium">Active schedules</h3>
          <span className="text-2xs font-mono text-fg-mute">{schedules.length} total</span>
        </div>
        {schedules.length === 0 ? (
          <div className="px-5 py-8 text-[13px] text-fg-2">
            No schedules yet. Create one below to run scans automatically.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {schedules.map((s) => (
              <li key={s.id} className="px-5 py-4 flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[13px] text-fg flex items-center gap-2 flex-wrap">
                    {s.targetValue}
                    {!s.active && (
                      <span className="text-2xs text-fg-mute border border-line-2 rounded px-1.5 py-0.5">
                        paused
                      </span>
                    )}
                    {s.hasCredentials && (
                      <span className="text-2xs text-info border border-info/40 rounded px-1.5 py-0.5">
                        authenticated
                      </span>
                    )}
                  </div>
                  <div className="text-2xs font-mono text-fg-mute mt-1">
                    {describeSchedule({
                      frequency: s.frequency,
                      hour: s.hour,
                      minute: s.minute,
                      dayOfWeek: s.dayOfWeek,
                      dayOfMonth: s.dayOfMonth,
                      timezone: s.timezone,
                    })}
                  </div>
                  <div className="text-2xs font-mono text-fg-mute mt-1">
                    {s.active ? (
                      <>next run {fmt(s.nextRunAt)}</>
                    ) : (
                      <>paused — won&apos;t run</>
                    )}
                    {s.lastRunAt && (
                      <>
                        {" · "}last run{" "}
                        {s.lastScanId ? (
                          <Link href={`/scans/${s.lastScanId}`} className="underline hover:text-fg">
                            {fmt(s.lastRunAt)}
                          </Link>
                        ) : (
                          fmt(s.lastRunAt)
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="line"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      act(() => setScheduleActive(s.id, !s.active), s.active ? "Schedule paused." : "Schedule resumed.")
                    }
                  >
                    {s.active ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Delete the schedule for ${s.targetValue}?`)) {
                        act(() => deleteSchedule(s.id), "Schedule deleted.");
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* -------- create a schedule -------- */}
      {targets.length === 0 ? (
        <Panel className="px-6 py-10">
          <div className="max-w-md mx-auto text-center">
            <div className="eyebrow mb-3">no verified scope</div>
            <p className="text-fg-2 text-[14px]">
              Add and verify a target under{" "}
              <Link href="/assets" className="underline text-fg">
                Assets
              </Link>{" "}
              before scheduling scans.
            </p>
          </div>
        </Panel>
      ) : (
        <Panel className="p-6">
          <h3 className="text-[13px] font-medium mb-5">New schedule</h3>
          <form
            action={(fd) => act(() => createSchedule(fd), "Schedule created.")}
            className="flex flex-col gap-5 max-w-2xl"
          >
            {/* hidden computed fields */}
            <input type="hidden" name="hour" value={Number(hh)} />
            <input type="hidden" name="minute" value={Number(mm)} />
            <input type="hidden" name="timezone" value={tz} />

            <Field label="Target" required>
              <select
                name="targetId"
                required
                defaultValue=""
                className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
              >
                <option value="" disabled>
                  Choose a target…
                </option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.value} ({t.type} · verified)
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Frequency" required>
                <select
                  name="frequency"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as Frequency)}
                  className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </Field>

              <Field label="Time" required hint={`Your timezone: ${tz}`}>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
                />
              </Field>

              {frequency === "weekly" && (
                <Field label="Day of week" required>
                  <select
                    name="dayOfWeek"
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                    className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
                  >
                    {DOW.map((d, i) => (
                      <option key={i} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {frequency === "monthly" && (
                <Field label="Day of month" required hint="1–28 (so every month has it)">
                  <select
                    name="dayOfMonth"
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number(e.target.value))}
                    className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <Field label="Notes" hint="Optional — carried onto every scan this schedule creates.">
              <Textarea name="notes" placeholder="e.g. Skip /admin/billing — production data." />
            </Field>

            {/* Authenticated (gray-box) scanning — optional, reused on every run */}
            <details className="border border-line-2 rounded-lg overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-mono text-fg-2 hover:text-fg flex items-center gap-2">
                Authenticated scan
                <span className="text-2xs text-fg-mute">(optional)</span>
                <span className="text-2xs text-fg-mute ml-auto">test the logged-in surface →</span>
              </summary>
              <div className="p-4 flex flex-col gap-4 border-t border-line">
                <p className="text-2xs text-fg-mute font-mono leading-relaxed">
                  Give the agent a <span className="text-fg-2">throwaway test account</span>. Credentials are{" "}
                  <span className="text-fg-2">encrypted at rest</span> and reused on each scheduled run. Leave
                  blank for a black-box scan.
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Login URL" hint="Where the login form / API is">
                    <Input name="loginUrl" placeholder="https://app.example.com/login" autoComplete="off" />
                  </Field>
                  <Field label="Username / email" hint="The test account">
                    <Input name="username" placeholder="pentest@example.com" autoComplete="off" />
                  </Field>
                  <Field label="Password" hint="Stored encrypted">
                    <Input name="password" type="password" placeholder="••••••••" autoComplete="new-password" />
                  </Field>
                  <Field label="Auth header or cookie" hint="For JWT / API apps">
                    <Input name="authHeader" placeholder="Authorization: Bearer eyJ…" autoComplete="off" />
                  </Field>
                </div>
                <Field label="Auth notes" hint="Anything the agent needs to log in / stay authenticated">
                  <Textarea name="authNotes" placeholder="e.g. MFA is disabled for this test account." />
                </Field>
              </div>
            </details>

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" variant="solid" size="lg" disabled={pending}>
                {pending ? "Saving…" : "Create schedule"}
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {msg && (
        <div className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>{msg.text}</div>
      )}
    </div>
  );
}
