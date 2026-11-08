import { useEffect, useState } from "react";
import type { Destination, Payout, Plan, RouteRecord, TokenMeta } from "../near";
import { getPayouts, getPlanDestinations, getRoute } from "../near";
import { download, formatAmount, formatInterval, formatTime, shortAccount, sum, toCsv } from "../format";
import { EXPLORER, destinationLabel } from "../config";

export function PlanDetail({ plan, meta, keeperRuns }: { plan: Plan; meta: TokenMeta | null; keeperRuns: Array<{ plan_id: number; outcome: any; tx: string }> }) {
  const isNear = plan.asset === "Near";
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [routes, setRoutes] = useState<Record<number, RouteRecord>>({});
  const [dests, setDests] = useState<Record<string, Destination>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const from = Math.max(0, plan.payout_count - 40);
      const list = await getPayouts(plan.id, from, 40);
      const d = await getPlanDestinations(plan.id);
      if (cancelled) return;
      setPayouts(list.slice().reverse());
      setRoutes({});
      setDests(Object.fromEntries(d));
      const routed: Record<number, RouteRecord> = {};
      await Promise.all(
        list.map(async (p) => {
          if (!dests[p.recipient] && !d.some(([a]) => a === p.recipient)) return;
          const r = await getRoute(plan.id, p.seq);
          if (r) routed[p.seq] = r;
        }),
      );
      if (!cancelled) setRoutes(routed);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, plan.payout_count]);

  const rows = payouts ?? [];
  const txFor = (runIndex: number) => keeperRuns.find((r) => r.plan_id === plan.id && r.outcome?.Sent?.run_index === runIndex)?.tx;
  const perRun = sum(plan.recipients.map((r) => r.amount));

  const exportCsv = () => {
    const csvRows = rows.map((p) => ({
      plan_id: p.plan_id,
      seq: p.seq,
      run: p.run_index,
      recipient: p.recipient,
      amount: formatAmount(p.amount, meta, isNear),
      amount_base_units: p.amount,
      status: p.status,
      paid_at_utc: new Date(p.timestamp * 1000).toISOString(),
      block_height: p.block_height,
      routed_to: routes[p.seq] ? `${destinationLabel(routes[p.seq].destination_asset)} ${routes[p.seq].destination_address}` : "",
      deposit_address: routes[p.seq]?.deposit_address ?? "",
      tx: txFor(p.run_index) ? `${EXPLORER}/txns/${txFor(p.run_index)}` : "",
    }));
    download(`standing-order-plan-${plan.id}-payouts.csv`, toCsv(csvRows));
  };

  return (
    <div className="card detail">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <div>
          <h2>{plan.title}</h2>
          <div className="tiny mono">plan #{plan.id} · {formatInterval(plan.interval_seconds)} · created {formatTime(plan.created_at)}</div>
        </div>
        <button className="btn ghost sm" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </div>

      <div className="kv">
        <div><span className="k">Treasury (owner)</span><span className="v">{plan.owner}</span></div>
        <div><span className="k">Asset</span><span className="v">{isNear ? "NEAR" : (plan.asset as any).Ft.contract}</span></div>
        <div><span className="k">Balance</span><span className="v">{formatAmount(plan.balance, meta, isNear)}</span></div>
        <div><span className="k">Cap per run</span><span className="v">{formatAmount(plan.cap_per_run, meta, isNear)} (run total {formatAmount(perRun, meta, isNear)})</span></div>
        <div><span className="k">Next run</span><span className="v">{formatTime(plan.next_run_at)}</span></div>
        <div><span className="k">Ends</span><span className="v">{plan.end_at ? formatTime(plan.end_at) : "open-ended"}</span></div>
      </div>

      <div>
        <h3>Recipients</h3>
        <div className="table-wrap">
        <table>
          <thead><tr><th>Account</th><th>Paid where</th><th className="num">Per run</th></tr></thead>
          <tbody>
            {plan.recipients.map((r) => (
              <tr key={r.account_id}>
                <td className="mono">{r.account_id}</td>
                <td>{dests[r.account_id] ? <span className="chip blue" title={dests[r.account_id].address}>{destinationLabel(dests[r.account_id].asset_id)} · {shortAccount(dests[r.account_id].address, 14)}</span> : <span className="muted">NEAR account</span>}</td>
                <td className="num">{formatAmount(r.amount, meta, isNear)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div>
        <h3>Payout history</h3>
        {payouts === null ? (
          <div className="empty">Loading payout history…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No payouts yet. The first run is due {formatTime(plan.next_run_at)}.</div>
        ) : (
          <div className="table-wrap">
          <table>
            <thead><tr><th>Run</th><th>Recipient</th><th className="num">Amount</th><th>Status</th><th>When</th><th>Proof</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const route = routes[p.seq];
                const tx = txFor(p.run_index);
                return (
                  <tr key={p.seq}>
                    <td className="mono">{p.run_index}</td>
                    <td className="mono">
                      {shortAccount(p.recipient)}
                      {route && <div className="tiny">→ {destinationLabel(route.destination_asset)} {shortAccount(route.destination_address, 12)}</div>}
                    </td>
                    <td className="num">{formatAmount(p.amount, meta, isNear)}</td>
                    <td><span className={`chip ${p.status === "Sent" ? "active" : p.status === "Failed" ? "failed" : "neutral"}`}>{p.status}</span></td>
                    <td className="muted">{formatTime(p.timestamp)}</td>
                    <td className="tiny">
                      {tx ? <a href={`${EXPLORER}/txns/${tx}`} target="_blank" rel="noreferrer">tx ↗</a> : <a href={`${EXPLORER}/blocks/${p.block_height}`} target="_blank" rel="noreferrer">block {p.block_height} ↗</a>}
                      {route && <div><a href={`${EXPLORER}/address/${route.deposit_address}`} target="_blank" rel="noreferrer">deposit addr ↗</a></div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="note">
        Managed by the treasury, not by this page: the DAO files <b>pause</b>, <b>resume</b>, <b>top up</b>, <b>update</b> or <b>cancel</b> as proposals
        (Trezu templates in <code>trezu-templates/</code>). Anyone can trigger a due run; the keeper does it automatically.
      </div>
    </div>
  );
}
