import { useEffect, useState } from "react";
import type { Payout, Plan, TokenMeta } from "../near";
import { getAllPayouts, getPayouts, getPlanDestinations, getRoute } from "../near";
import { EXPLORER, destinationLabel } from "../config";
import { download, formatAmount, formatDecimal, shortAccount, sum, toCsv } from "../format";

export interface FeedItem extends Payout {
  planTitle: string;
  isNear: boolean;
}

/** Latest payouts across all plans, newest first, read straight from the contract. */
export function useRecentPayouts(plans: Plan[], perPlan = 8): FeedItem[] {
  const [items, setItems] = useState<FeedItem[]>([]);
  const key = plans.map((p) => `${p.id}:${p.payout_count}`).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lists = await Promise.all(
        plans
          .filter((p) => p.payout_count > 0)
          .map(async (p) => {
            const rows = await getPayouts(p.id, Math.max(0, p.payout_count - perPlan), perPlan).catch(() => [] as Payout[]);
            return rows.map((r) => ({ ...r, planTitle: p.title, isNear: p.asset === "Near" }));
          }),
      );
      if (!cancelled) setItems(lists.flat().sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq).slice(0, 12));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return items;
}

export function ago(seconds: number, nowMs: number): string {
  const d = Math.max(0, Math.floor(nowMs / 1000 - seconds));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86_400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86_400)} d ago`;
}

/**
 * Full ledger, every payout of every plan, oldest first, one row per transfer, with the token spelled out and the
 * cross-chain destination when the recipient was paid through NEAR Intents. Amounts are plain decimals (no grouping).
 */
export async function buildLedgerCsv(plans: Plan[], meta: TokenMeta | null): Promise<{ csv: string; rows: number }> {
  const perPlan = await Promise.all(
    plans
      .filter((p) => p.payout_count > 0)
      .map(async (plan) => {
        const isNear = plan.asset === "Near";
        const [payouts, dests] = await Promise.all([getAllPayouts(plan), getPlanDestinations(plan.id).catch(() => [] as Array<[string, unknown]>)]);
        const routedRecipients = new Set(dests.map(([a]) => a));
        const routes = new Map<number, string>();
        await Promise.all(
          payouts
            .filter((p) => routedRecipients.has(p.recipient))
            .map(async (p) => {
              const r = await getRoute(plan.id, p.seq).catch(() => null);
              if (r) routes.set(p.seq, `${destinationLabel(r.destination_asset)} ${r.destination_address}`);
            }),
        );
        const tokenContract = isNear ? "near" : (plan.asset as { Ft: { contract: string } }).Ft.contract;
        const symbol = isNear ? "NEAR" : meta?.symbol ?? tokenContract;
        const decimals = isNear ? 24 : meta?.decimals ?? 0;
        return payouts.map((p) => ({
          date: new Date(p.timestamp * 1000).toISOString(),
          plan_id: p.plan_id,
          plan_title: plan.title,
          seq: p.seq,
          recipient: p.recipient,
          amount: meta || isNear ? formatDecimal(p.amount, decimals) : p.amount,
          token_symbol: symbol,
          token_contract: tokenContract,
          outcome: p.status.toLowerCase(),
          route: routes.get(p.seq) ?? "near",
          block_height: p.block_height,
          block_url: `${EXPLORER}/blocks/${p.block_height}`,
          _ts: p.timestamp,
        }));
      }),
  );
  const all = perPlan.flat().sort((a, b) => a._ts - b._ts || a.plan_id - b.plan_id || a.seq - b.seq);
  const rows = all.map(({ _ts, ...r }) => r);
  return { csv: toCsv(rows), rows: rows.length };
}

export function LiveFeed({ items, meta, nowMs, plans }: { items: FeedItem[]; meta: TokenMeta | null; nowMs: number; plans: Plan[] }) {
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const payoutCount = plans.reduce((a, p) => a + p.payout_count, 0);
  // Per-plan runs × per-run total is the on-chain aggregate; failed transfers are re-credited, so this is an upper bound.
  const totalFt = plans.filter((p) => p.asset !== "Near").reduce((acc, p) => acc + BigInt(p.runs_completed) * sum(p.recipients.map((r) => r.amount)), 0n);

  const exportCsv = async () => {
    setExporting(true);
    setExportErr(null);
    try {
      const { csv, rows } = await buildLedgerCsv(plans, meta);
      if (rows === 0) throw new Error("no payouts to export yet");
      download(`standing-order-ledger-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (e) {
      setExportErr(String((e as any)?.message ?? e).slice(0, 120));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card pad">
      <div className="section-head">
        <h2>Live payouts</h2>
        <span className="pill ok"><span className="dot" />on-chain</span>
      </div>
      <div className="ledger-bar">
        <span className="tiny mono">
          {payoutCount > 0 ? `${payoutCount} payout${payoutCount === 1 ? "" : "s"} · total ${formatAmount(totalFt, meta, false)}` : "no payouts recorded yet"}
        </span>
        <button className="btn ghost sm" onClick={exportCsv} disabled={exporting || payoutCount === 0} title="Every payout of every plan as CSV: date, plan, recipient, amount, token, outcome, destination">
          {exporting ? "Building CSV…" : "Download CSV"}
        </button>
      </div>
      {exportErr && <div className="tiny err-text" style={{ marginBottom: 8 }}>Export failed: {exportErr}</div>}
      {items.length === 0 ? (
        <div className="empty">Waiting for the first payout…</div>
      ) : (
        <ul className="feed">
          {items.map((it) => (
            <li key={`${it.plan_id}-${it.seq}`} className={nowMs / 1000 - it.timestamp < 90 ? "fresh" : ""}>
              <span className={`feed-dot ${it.status === "Failed" ? "bad" : ""}`} />
              <div className="feed-body">
                <div>
                  <b className="mono">{shortAccount(it.recipient, 40)}</b> received <b className="mono nowrap">{formatAmount(it.amount, meta, it.isNear)}</b>
                </div>
                <div className="tiny">
                  {it.planTitle} · run {it.run_index} · {it.status === "Failed" ? "failed, re-credited" : it.status.toLowerCase()} ·{" "}
                  <a href={`${EXPLORER}/blocks/${it.block_height}`} target="_blank" rel="noreferrer">block ↗</a>
                </div>
              </div>
              <span className="tiny feed-ago">{ago(it.timestamp, nowMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
