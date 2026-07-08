"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  LOGO_MAX_BYTES,
  LOGO_MIME,
  SEVERITY_ORDER,
  SIGNAL,
  countBySeverity,
  type ReportDoc,
  type ReportFinding,
  type ReportSeverity,
} from "@/lib/report";
import {
  updateReport,
  setReportStatus,
  deleteReport,
  importScanFindings,
} from "@/lib/actions/reports";
import type { ImportableScan } from "@/lib/queries";

// The editable subset persisted by updateReport().
type FormState = {
  title: string;
  clientName: string;
  clientTagline: string;
  engagementRef: string;
  preparedBy: string;
  logoDataUrl: string | null;
  executiveSummary: string;
  scopeText: string;
  methodology: string;
  findings: ReportFinding[];
  confidential: boolean;
};

function toForm(r: ReportDoc): FormState {
  return {
    title: r.title,
    clientName: r.clientName,
    clientTagline: r.clientTagline ?? "",
    engagementRef: r.engagementRef ?? "",
    preparedBy: r.preparedBy || "PWNTROL",
    logoDataUrl: r.logoDataUrl,
    executiveSummary: r.executiveSummary ?? "",
    scopeText: r.scopeText ?? "",
    methodology: r.methodology ?? "",
    findings: r.findings,
    confidential: r.confidential,
  };
}

function newFinding(): ReportFinding {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `f${Date.now()}${Math.round(Math.random() * 1e6)}`;
  return {
    id,
    title: "",
    severity: "medium",
    cwe: "",
    location: "",
    description: "",
    remediation: "",
  };
}

const INPUT =
  "w-full bg-ink-3 border border-line-2 rounded px-3 py-2 text-[13px] text-fg placeholder:text-fg-mute focus:border-fg outline-none transition-colors";
const LABEL = "block text-2xs font-mono text-fg-mute mb-1.5";

export function ReportEditor({
  report,
  importableScans,
  printHref,
}: {
  report: ReportDoc;
  importableScans: ImportableScan[];
  printHref: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toForm(report));
  const [status, setStatus] = useState<string>(report.status);
  const baseline = useRef<string>(JSON.stringify(toForm(report)));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importScanId, setImportScanId] = useState<string>(
    importableScans[0]?.id ?? ""
  );

  const dirty = useMemo(
    () => JSON.stringify(form) !== baseline.current,
    [form]
  );
  const counts = useMemo(() => countBySeverity(form.findings), [form.findings]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function patchFinding(id: string, patch: Partial<ReportFinding>) {
    setForm((f) => ({
      ...f,
      findings: f.findings.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
  }
  function removeFinding(id: string) {
    setForm((f) => ({ ...f, findings: f.findings.filter((x) => x.id !== id) }));
  }
  function moveFinding(id: string, dir: -1 | 1) {
    setForm((f) => {
      const arr = [...f.findings];
      const i = arr.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return f;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...f, findings: arr };
    });
  }

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!LOGO_MIME.includes(file.type)) {
      setMsg({ ok: false, text: "Logo must be PNG, JPG, SVG, or WebP." });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setMsg({ ok: false, text: "Logo is too large (max 512 KB)." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("logoDataUrl", String(reader.result));
    reader.onerror = () => setMsg({ ok: false, text: "Could not read the file." });
    reader.readAsDataURL(file);
  }

  async function persist(): Promise<{ ok: boolean; message: string }> {
    const payload = {
      title: form.title,
      clientName: form.clientName,
      clientTagline: form.clientTagline || null,
      engagementRef: form.engagementRef || null,
      preparedBy: form.preparedBy,
      logoDataUrl: form.logoDataUrl,
      executiveSummary: form.executiveSummary || null,
      scopeText: form.scopeText || null,
      methodology: form.methodology || null,
      findings: form.findings,
      confidential: form.confidential,
    };
    const r = await updateReport(report.id, payload);
    if (r.ok) baseline.current = JSON.stringify(form);
    return r;
  }

  function onSave() {
    setMsg(null);
    start(async () => {
      const r = await persist();
      setMsg({ ok: r.ok, text: r.message });
    });
  }

  function onPreview() {
    setMsg(null);
    start(async () => {
      if (dirty) {
        const r = await persist();
        setMsg({ ok: r.ok, text: r.ok ? "Saved — opening preview…" : r.message });
        if (!r.ok) return;
      }
      window.open(printHref, "_blank", "noopener");
    });
  }

  function onToggleStatus() {
    const next = status === "final" ? "draft" : "final";
    setMsg(null);
    start(async () => {
      const r = await setReportStatus(report.id, next);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setStatus(next);
    });
  }

  function onImport() {
    if (!importScanId) return;
    setMsg(null);
    start(async () => {
      const r = await importScanFindings(report.id, importScanId);
      if (r.ok) {
        setForm((f) => {
          const seen = new Set(f.findings.map((x) => x.id));
          const fresh = r.findings.filter((x) => !seen.has(x.id));
          return { ...f, findings: [...f.findings, ...fresh] };
        });
      }
      setMsg({ ok: r.ok, text: r.message });
    });
  }

  function onDelete() {
    if (!confirm("Delete this report permanently? This cannot be undone.")) return;
    start(async () => {
      await deleteReport(report.id);
    });
  }

  return (
    <div className="pb-24">
      {/* Sticky action bar */}
      <div className="sticky top-14 z-30 -mx-6 md:-mx-10 px-6 md:px-10 py-3 bg-ink/90 backdrop-blur-md border-b border-line mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span
              className={`font-mono text-2xs px-2 py-0.5 rounded border ${
                status === "final"
                  ? "border-ok/40 text-ok"
                  : "border-line-2 text-fg-mute"
              }`}
            >
              {status}
            </span>
            <span className="font-mono text-2xs text-fg-mute">
              {dirty ? "● unsaved changes" : "✓ all changes saved"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onDelete} disabled={pending}>
              Delete
            </Button>
            <Button variant="line" size="sm" onClick={onToggleStatus} disabled={pending}>
              {status === "final" ? "Reopen draft" : "Mark final"}
            </Button>
            <Button variant="line" size="sm" onClick={onPreview} disabled={pending}>
              Preview / Export PDF
            </Button>
            <Button variant="solid" size="sm" onClick={onSave} disabled={pending || !dirty}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        {msg && (
          <div className={`mt-2 font-mono text-2xs ${msg.ok ? "text-ok" : "text-crit"}`}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* LEFT: cover / client details */}
        <div className="lg:col-span-1 space-y-6">
          <Section title="Cover & client">
            <div className="space-y-4">
              <div>
                <label className={LABEL}>Report title</label>
                <input
                  className={INPUT}
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="Security Assessment Report"
                />
                <p className="mt-1 text-2xs text-fg-mute">
                  The last word renders in Fraunces italic on the cover.
                </p>
              </div>
              <div>
                <label className={LABEL}>Client name</label>
                <input
                  className={INPUT}
                  value={form.clientName}
                  onChange={(e) => set("clientName", e.target.value)}
                  placeholder="ACME Corp"
                />
              </div>
              <div>
                <label className={LABEL}>Client tagline / sector</label>
                <input
                  className={INPUT}
                  value={form.clientTagline}
                  onChange={(e) => set("clientTagline", e.target.value)}
                  placeholder="fintech"
                />
              </div>
              <div>
                <label className={LABEL}>Engagement reference</label>
                <input
                  className={INPUT}
                  value={form.engagementRef}
                  onChange={(e) => set("engagementRef", e.target.value)}
                  placeholder="ENGAGEMENT REPORT · Q3 2026"
                />
              </div>
              <div>
                <label className={LABEL}>Prepared by</label>
                <input
                  className={INPUT}
                  value={form.preparedBy}
                  onChange={(e) => set("preparedBy", e.target.value)}
                  placeholder="PWNTROL"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.confidential}
                  onChange={(e) => set("confidential", e.target.checked)}
                  className="accent-fg"
                />
                <span className="text-[13px] text-fg-2">
                  Mark “confidential · classified”
                </span>
              </label>
            </div>
          </Section>

          <Section title="Client logo">
            <div className="space-y-3">
              {form.logoDataUrl ? (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded border border-line-2 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.logoDataUrl}
                      alt="Client logo"
                      className="max-h-12 max-w-[160px] object-contain"
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => set("logoDataUrl", null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <p className="text-2xs text-fg-mute">
                  No logo. It appears on the report header (cover). Transparent
                  PNG/SVG looks best on the dark cover.
                </p>
              )}
              <label className="inline-flex">
                <span className="cursor-pointer font-mono text-2xs px-3 py-1.5 rounded border border-line-2 text-fg-2 hover:border-fg hover:text-fg transition-colors">
                  {form.logoDataUrl ? "Replace logo" : "Upload logo"}
                </span>
                <input
                  type="file"
                  accept={LOGO_MIME.join(",")}
                  onChange={onLogoFile}
                  className="hidden"
                />
              </label>
              <p className="text-2xs text-fg-mute">PNG · JPG · SVG · WebP, max 512 KB.</p>
            </div>
          </Section>

          <Section title="Severity mix">
            <div className="grid grid-cols-5 gap-2">
              {SEVERITY_ORDER.map((sev) => (
                <div
                  key={sev}
                  className="border border-line rounded px-2 py-2 text-center"
                  style={{ borderLeftColor: SIGNAL[sev], borderLeftWidth: 3 }}
                >
                  <div
                    className="text-[18px] font-medium leading-none"
                    style={{ color: counts[sev] ? SIGNAL[sev] : "#6a6a6a" }}
                  >
                    {counts[sev]}
                  </div>
                  <div className="mt-1 text-[9px] uppercase tracking-wider text-fg-mute">
                    {sev.slice(0, 4)}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* RIGHT: narrative + findings */}
        <div className="lg:col-span-2 space-y-6">
          <Section title="Executive summary">
            <textarea
              className={`${INPUT} min-h-[120px] resize-y`}
              value={form.executiveSummary}
              onChange={(e) => set("executiveSummary", e.target.value)}
              placeholder="High-level narrative for a non-technical audience: what was tested, the overall risk posture, and the headline findings."
            />
          </Section>

          <div className="grid md:grid-cols-2 gap-6">
            <Section title="Engagement scope">
              <textarea
                className={`${INPUT} min-h-[100px] resize-y`}
                value={form.scopeText}
                onChange={(e) => set("scopeText", e.target.value)}
                placeholder="Targets, environments, and boundaries covered by this engagement."
              />
            </Section>
            <Section title="Methodology">
              <textarea
                className={`${INPUT} min-h-[100px] resize-y`}
                value={form.methodology}
                onChange={(e) => set("methodology", e.target.value)}
                placeholder="Approach, standards followed (OWASP, PTES…), and tooling."
              />
            </Section>
          </div>

          <Section
            title={`Findings · ${form.findings.length}`}
            right={
              <Button variant="line" size="sm" onClick={() => set("findings", [...form.findings, newFinding()])}>
                + Add finding
              </Button>
            }
          >
            {/* Import from scan */}
            {importableScans.length > 0 && (
              <div className="mb-5 p-3 rounded border border-line bg-ink-2 flex items-center gap-2 flex-wrap">
                <span className="text-2xs font-mono text-fg-mute">import from scan:</span>
                <select
                  className="bg-ink-3 border border-line-2 rounded px-2 py-1.5 text-2xs text-fg outline-none focus:border-fg"
                  value={importScanId}
                  onChange={(e) => setImportScanId(e.target.value)}
                >
                  {importableScans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.targetValue} · {s.findingCount} finding{s.findingCount === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="sm" onClick={onImport} disabled={pending || !importScanId}>
                  Import
                </Button>
              </div>
            )}

            {form.findings.length === 0 && (
              <p className="text-fg-mute text-sm py-6 text-center">
                No findings yet. Add one manually or import from a scan.
              </p>
            )}

            <div className="space-y-4">
              {form.findings.map((f, i) => (
                <div
                  key={f.id}
                  className="rounded border border-line bg-ink-2 p-4"
                  style={{ borderLeftColor: SIGNAL[f.severity], borderLeftWidth: 3 }}
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-2xs font-mono text-fg-mute">
                      finding {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="flex items-center gap-1">
                      <IconBtn label="Move up" onClick={() => moveFinding(f.id, -1)} disabled={i === 0}>↑</IconBtn>
                      <IconBtn label="Move down" onClick={() => moveFinding(f.id, 1)} disabled={i === form.findings.length - 1}>↓</IconBtn>
                      <IconBtn label="Remove" onClick={() => removeFinding(f.id)} danger>✕</IconBtn>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <input
                      className={INPUT}
                      value={f.title}
                      onChange={(e) => patchFinding(f.id, { title: e.target.value })}
                      placeholder="Finding title — e.g. SSRF in /api/v2/proxy"
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className={LABEL}>Severity</label>
                        <select
                          className={INPUT}
                          value={f.severity}
                          onChange={(e) =>
                            patchFinding(f.id, { severity: e.target.value as ReportSeverity })
                          }
                        >
                          {SEVERITY_ORDER.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={LABEL}>CWE</label>
                        <input
                          className={INPUT}
                          value={f.cwe}
                          onChange={(e) => patchFinding(f.id, { cwe: e.target.value })}
                          placeholder="CWE-918"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className={LABEL}>Location</label>
                        <input
                          className={INPUT}
                          value={f.location}
                          onChange={(e) => patchFinding(f.id, { location: e.target.value })}
                          placeholder="POST /api/v2/proxy"
                        />
                      </div>
                    </div>
                    <div>
                      <label className={LABEL}>Description</label>
                      <textarea
                        className={`${INPUT} min-h-[80px] resize-y`}
                        value={f.description}
                        onChange={(e) => patchFinding(f.id, { description: e.target.value })}
                        placeholder="What the issue is, how it was found, and its impact."
                      />
                    </div>
                    <div>
                      <label className={LABEL}>Remediation</label>
                      <textarea
                        className={`${INPUT} min-h-[70px] resize-y`}
                        value={f.remediation}
                        onChange={(e) => patchFinding(f.id, { remediation: e.target.value })}
                        placeholder="Recommended fix."
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-ink border border-line rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line">
        <h3 className="text-[13px] font-medium">{title}</h3>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  danger,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`w-6 h-6 rounded border text-2xs flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger
          ? "border-line-2 text-fg-mute hover:text-crit hover:border-crit"
          : "border-line-2 text-fg-mute hover:text-fg hover:border-fg"
      }`}
    >
      {children}
    </button>
  );
}
