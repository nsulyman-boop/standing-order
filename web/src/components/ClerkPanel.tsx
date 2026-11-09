import { useEffect, useState } from "react";

export interface ReviewIndexItem {
  file: string;
  proposal_id: number;
  type: "review" | "draft";
  verdict: "ok" | "warn" | "block";
  recommend?: string;
  headline?: string;
  verified?: boolean;
  model?: string;
  at: string;
}

const BASE = import.meta.env.BASE_URL ?? "/";

export function useClerkReviews(): ReviewIndexItem[] {
  const [items, setItems] = useState<ReviewIndexItem[]>([]);
  useEffect(() => {
    fetch(`${BASE}reviews/index.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setItems(Array.isArray(j) ? j.slice().sort((a, b) => b.proposal_id - a.proposal_id) : []))
      .catch(() => setItems([]));
  }, []);
  return items;
}

export function ClerkBadge({ review }: { review?: ReviewIndexItem }) {
  if (!review) return null;
  const tone = review.verdict === "block" ? "failed" : review.verdict === "warn" ? "blue" : "active";
  return (
    <a className={`chip ${tone}`} href={`${BASE}reviews/${review.file}`} target="_blank" rel="noreferrer" title={review.headline}>
      Clerk · {review.recommend ?? review.verdict}{review.verified ? " · TEE-verified" : ""}
    </a>
  );
}

export function ClerkPanel({ reviews }: { reviews: ReviewIndexItem[] }) {
  const [open, setOpen] = useState<any | null>(null);
  const latest = reviews[0];
  useEffect(() => {
    if (!latest) return;
    fetch(`${BASE}reviews/${latest.file}`).then((r) => r.json()).then(setOpen).catch(() => setOpen(null));
  }, [latest?.file]);
  return (
    <div className="card pad" id="clerk">
      <div className="section-head">
        <h2>Private payroll clerk</h2>
        <span className="pill"><span className="dot" style={{ background: "var(--green)" }} />NEAR AI Cloud · TEE</span>
      </div>
      <p className="muted">
        Before a payroll proposal goes to a vote, the clerk checks it: amounts in the wrong units, duplicates, unknown or non-existent
        accounts, raises, runway. It can also draft the proposal from contributor invoices. Salary data goes only to a NEAR-operated model
        inside a hardware enclave, and every run returns a signed receipt anyone can re-verify.
      </p>
      {!open ? (
        <div className="empty">No clerk reviews published yet.</div>
      ) : (
        <div className="form">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{open.type === "draft" ? `Draft → proposal #${open.proposal_id}` : `Review of proposal #${open.proposal_id}`}</b>
            <span className={`chip ${open.verdict === "block" ? "failed" : open.verdict === "warn" ? "blue" : "active"}`}>{open.brief?.recommend ?? open.verdict}</span>
          </div>
          {open.brief?.headline && <div>{open.brief.headline}</div>}
          {open.summary && <div className="muted">{open.summary}</div>}
          {(open.findings ?? []).length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {open.findings.map((f: any, i: number) => (
                <li key={i} className={f.level === "block" ? "err-text" : f.level === "warn" ? "" : "muted"} style={{ fontSize: 13.5 }}>{f.message}</li>
              ))}
            </ul>
          )}
          {(open.brief?.risks ?? []).filter((r: string) => r.includes("(model)")).map((r: string, i: number) => (
            <div key={i} className="tiny">model note: {r.replace("(model)", "").trim()}</div>
          ))}
          <div className="note">
            <b>Receipt.</b> model <code>{open.model}</code> · {open.receipt?.verified ? <span className="ok-text">verified</span> : <span className="err-text">unverified</span>} ({open.receipt?.signed_by}) ·
            request <code>{String(open.receipt?.request_hash).slice(0, 10)}…</code> response <code>{String(open.receipt?.response_hash).slice(0, 10)}…</code> ·
            signer <code>{String(open.receipt?.recovered_signer).slice(0, 10)}…</code>
            <div className="tiny" style={{ marginTop: 6 }}>{(open.receipt?.checks ?? []).join(" · ")}</div>
          </div>
          <div className="row">
            <a className="btn ghost sm" href={`${BASE}reviews/${latest!.file}`} target="_blank" rel="noreferrer">Full JSON</a>
            {reviews.length > 1 && <span className="tiny">{reviews.length} reviews published</span>}
          </div>
        </div>
      )}
    </div>
  );
}
