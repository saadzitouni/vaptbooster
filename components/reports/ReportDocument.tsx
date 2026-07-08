import {
  SIGNAL,
  SEVERITY_ACTION,
  SEVERITY_ORDER,
  countBySeverity,
  sortFindingsBySeverity,
  type ReportDoc,
} from "@/lib/report";

// Split a title so its final word can carry the Fraunces-italic emphasis
// (brand rule: emphasis words only, ≤2 per page).
function splitEmphasis(title: string): { head: string; tail: string } {
  const t = title.trim();
  const i = t.lastIndexOf(" ");
  if (i === -1) return { head: "", tail: t };
  return { head: t.slice(0, i), tail: t.slice(i + 1) };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Mark() {
  return (
    <div className="rd-mark">
      <span className="dot" />
      <span style={{ fontWeight: 500 }}>pwntrol</span>
      <span className="sep">/</span>
      <span style={{ color: "var(--stone)" }}>vaptbooster</span>
    </div>
  );
}

// The full deliverable. Renders identically on screen and in print (PDF).
export function ReportDocument({ report }: { report: ReportDoc }) {
  const findings = sortFindingsBySeverity(report.findings);
  const counts = countBySeverity(findings);
  const client = report.clientName || report.tenantName || "—";
  const { head, tail } = splitEmphasis(report.title);

  return (
    <div className="report-doc">
      {/* ---------- COVER (dark ink) ---------- */}
      <section className="rd-cover">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <Mark />
          {report.logoDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="rd-logo" src={report.logoDataUrl} alt={`${client} logo`} />
          )}
        </div>

        <div className="rd-cover-body">
          <div className="rd-eyebrow" style={{ marginBottom: 14 }}>
            // {report.engagementRef || "SECURITY ASSESSMENT"}
          </div>
          <h1 className="rd-cover-title">
            {head ? head : tail}
          </h1>
          {head && <span className="rd-em rd-cover-em">{tail}</span>}
          {!head && <span className="rd-em rd-cover-em">engagement</span>}

          <div className="rd-cover-meta">
            <strong>{client}</strong>
            {report.clientTagline ? ` · ${report.clientTagline}` : ""}
          </div>
          <div className="rd-cover-meta" style={{ marginTop: 6 }}>
            prepared by <strong>{report.preparedBy || "PWNTROL"}</strong>
          </div>

          <hr className="rd-cover-rule" />
          <div className="rd-cover-foot">
            {report.confidential ? "confidential · classified" : "internal use"} ·{" "}
            {report.status === "final" ? "final" : "draft"} · {fmtDate(report.generatedAt)}
          </div>
        </div>
      </section>

      {/* ---------- BODY (paper) ---------- */}
      <div className="rd-body">
        {/* Executive summary */}
        <section className="rd-section">
          <h2 className="rd-section-title">Executive summary</h2>
          {report.executiveSummary?.trim() ? (
            <p className="rd-prose">{report.executiveSummary}</p>
          ) : (
            <p className="rd-prose rd-muted">No executive summary provided.</p>
          )}
        </section>

        {/* Severity summary */}
        <section className="rd-section">
          <h2 className="rd-section-title">Findings at a glance</h2>
          <div className="rd-summary">
            {SEVERITY_ORDER.map((sev) => (
              <div key={sev} className="rd-sev" style={{ borderLeftColor: SIGNAL[sev] }}>
                <div className="n" style={{ color: counts[sev] ? SIGNAL[sev] : "var(--stone)" }}>
                  {counts[sev]}
                </div>
                <div className="k">{sev}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Scope */}
        {report.scopeText?.trim() && (
          <section className="rd-section">
            <h2 className="rd-section-title">Engagement scope</h2>
            <p className="rd-prose">{report.scopeText}</p>
          </section>
        )}

        {/* Methodology */}
        {report.methodology?.trim() && (
          <section className="rd-section">
            <h2 className="rd-section-title">Methodology</h2>
            <p className="rd-prose">{report.methodology}</p>
          </section>
        )}

        {/* Findings */}
        <section className="rd-section">
          <h2 className="rd-section-title">
            Findings <span className="rd-muted">· {findings.length}</span>
          </h2>
          {findings.length === 0 && (
            <p className="rd-prose rd-muted">No findings recorded.</p>
          )}
          {findings.map((f, i) => (
            <article
              key={f.id || i}
              className="rd-finding"
              style={{ borderLeftColor: SIGNAL[f.severity] }}
            >
              <h3 className="rd-finding-title">{f.title || "Untitled finding"}</h3>
              <div className="rd-finding-meta">
                <span className="sev" style={{ color: SIGNAL[f.severity] }}>
                  {f.severity}
                </span>
                <span className="rd-muted">{SEVERITY_ACTION[f.severity]}</span>
                {f.cwe && <span>{f.cwe}</span>}
                {f.location && <span>{f.location}</span>}
              </div>
              {f.description?.trim() && (
                <div className="rd-finding-body">{f.description}</div>
              )}
              {f.remediation?.trim() && (
                <>
                  <div className="rd-fix-label">Remediation</div>
                  <div className="rd-finding-body">{f.remediation}</div>
                </>
              )}
            </article>
          ))}
        </section>
      </div>

      <footer className="rd-footer">
        <span>PWNTROL Consultancy FZCO · Dubai, UAE · pwntrol.com</span>
        <span>{client}</span>
      </footer>
    </div>
  );
}
