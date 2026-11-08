// Keyless live watcher: prints new payouts as they land. Usage: npm run watch
import { cfg, view } from "./lib/near.ts";

const meta = await view<any>(cfg.token, "ft_metadata").catch(() => null);
const units = meta ? 10n ** BigInt(meta.decimals) : 1n;
const fmt = (v: string) => (meta ? `${Number(BigInt(v) * 100n / units) / 100} ${meta.symbol}` : v);
const seen = new Map<number, number>();
console.log(`watching ${cfg.contract} (ctrl-c to stop)`);
for (;;) {
  const plans = await view<any[]>(cfg.contract, "get_plans", { from_index: 0, limit: 50 });
  for (const p of plans) {
    const last = seen.get(p.id);
    if (last === undefined) {
      seen.set(p.id, p.payout_count);
      console.log(`plan #${p.id} "${p.title}" ${p.status} · next run ${new Date(p.next_run_at * 1000).toISOString()} · ${p.payout_count} payouts so far`);
      continue;
    }
    if (p.payout_count > last) {
      const fresh = await view<any[]>(cfg.contract, "get_payouts", { plan_id: p.id, from_seq: last, limit: p.payout_count - last });
      for (const o of fresh) console.log(`${new Date(o.timestamp * 1000).toISOString()} plan #${p.id} run ${o.run_index} → ${o.recipient} ${fmt(o.amount)} ${o.status}`);
      seen.set(p.id, p.payout_count);
    }
  }
  await new Promise((r) => setTimeout(r, 5000));
}
