import { useEffect, useState } from "react";
import type { Payout, Plan, TokenMeta } from "../near";
import { getPayouts } from "../near";
import { EXPLORER } from "../config";
import { formatAmount, shortAccount } from "../format";

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

export function LiveFeed({ items, meta, nowMs }: { items: FeedItem[]; meta: TokenMeta | null; nowMs: number }) {
  return (
    <div className="card pad">
      <div className="section-head">
        <h2>Live payouts</h2>
        <span className="pill ok"><span className="dot" />on-chain</span>
      </div>
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
