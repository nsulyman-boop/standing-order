import type { Plan, TokenMeta } from "../near";
import { formatAmount, formatCountdown, formatInterval, sum } from "../format";

export function statusChip(p: Plan, underfunded: boolean) {
  if (p.status === "Active" && underfunded) return <span className="chip failed">Needs top-up</span>;
  if (p.status === "Active" && p.run_cursor !== null) return <span className="chip blue">Paying…</span>;
  return <span className={`chip ${p.status.toLowerCase()}`}>{p.status}</span>;
}

export function PlanCard({ plan, meta, nowMs, selected, onSelect }: { plan: Plan; meta: TokenMeta | null; nowMs: number; selected: boolean; onSelect: () => void }) {
  const isNear = plan.asset === "Near";
  const perRun = sum(plan.recipients.map((r) => r.amount));
  const balance = BigInt(plan.balance);
  const runsLeft = perRun > 0n ? Number(balance / perRun) : 0;
  const underfunded = plan.status === "Active" && balance < perRun;
  const cd = formatCountdown(plan.next_run_at, nowMs);
  const ended = plan.end_at !== null && plan.next_run_at > plan.end_at;
  // Progress of the funded horizon: paid runs vs paid + remaining.
  const total = plan.runs_completed + runsLeft;
  const pct = total > 0 ? Math.round((plan.runs_completed / total) * 100) : 0;
  return (
    <div className={`card plan ${selected ? "selected" : ""}`} onClick={onSelect} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect()}>
      <div className="plan-top">
        <div style={{ flex: 1 }}>
          <div className="plan-title">{plan.title}</div>
          <div className="plan-owner mono">#{plan.id} · owned by {plan.owner}</div>
        </div>
        {ended ? <span className="chip neutral">Ended</span> : statusChip(plan, underfunded)}
      </div>
      <div className="plan-metrics">
        <div className="metric">
          <div className="label">Per run</div>
          <div className="value big">{formatAmount(perRun, meta, isNear)}</div>
        </div>
        <div className="metric">
          <div className="label">Next run</div>
          <div className={`value big ${cd.due && plan.status === "Active" && !ended ? "due" : ""}`}>{plan.status === "Active" && !ended ? cd.text : "—"}</div>
        </div>
        <div className="metric">
          <div className="label">Recipients</div>
          <div className="value big">{plan.recipients.length}</div>
        </div>
      </div>
      <div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        <div className="plan-foot" style={{ marginTop: 8 }}>
          <span>{plan.runs_completed} run{plan.runs_completed === 1 ? "" : "s"} paid · {runsLeft} funded ahead</span>
          <span>{formatInterval(plan.interval_seconds)} · balance {formatAmount(balance, meta, isNear)}</span>
        </div>
      </div>
    </div>
  );
}
