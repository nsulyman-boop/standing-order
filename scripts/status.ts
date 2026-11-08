// Print plans, payouts and balances.
import { cfg, view, yoctoToNear, provider } from "./lib/near.ts";

const meta = await view<any>(cfg.token, "ft_metadata").catch(() => null);
const units = meta ? 10n ** BigInt(meta.decimals) : 1n;
const fmt = (v: string | number) => (meta ? `${Number(BigInt(v) * 1000n / units) / 1000} ${meta.symbol}` : yoctoToNear(String(v)) + " NEAR");
const now = await view<number>(cfg.contract, "now_seconds");
const plans = await view<any[]>(cfg.contract, "get_plans", { from_index: 0, limit: 50 });
console.log(`contract ${cfg.contract} | dao ${cfg.dao} | chain time ${new Date(now * 1000).toISOString()}`);
console.log(`DAO token balance: ${fmt(await view<string>(cfg.token, "ft_balance_of", { account_id: cfg.dao }))}`);
for (const p of plans) {
  const isFt = typeof p.asset === "object";
  const f = isFt ? fmt : (v: string) => yoctoToNear(v) + " NEAR";
  const perRun = p.recipients.reduce((a: bigint, r: any) => a + BigInt(r.amount), 0n);
  const ended = p.end_at !== null && (p.end_at <= now || p.next_run_at > p.end_at);
  const underfunded = p.status === "Active" && BigInt(p.balance) < perRun;
  const when = ended
    ? "ended"
    : p.next_run_at - now >= 0
      ? "in " + (p.next_run_at - now) + "s"
      : underfunded
        ? "underfunded, needs top-up"
        : p.status === "Active"
          ? "due"
          : p.status.toLowerCase();
  console.log(`\nPlan #${p.id} "${p.title}" [${p.status}] owner=${p.owner}`);
  console.log(`  every ${p.interval_seconds}s | next run ${new Date(p.next_run_at * 1000).toISOString()} (${when}) | runs done ${p.runs_completed}${p.end_at !== null ? ` | ends ${new Date(p.end_at * 1000).toISOString()}` : ""}`);
  console.log(`  balance ${f(p.balance)} | per run ${f(perRun.toString())} | cap ${f(p.cap_per_run)}${underfunded ? " | UNDERFUNDED: balance below one run, top up before the next run" : ""}`);
  for (const r of p.recipients) console.log(`  - ${r.account_id}: ${f(r.amount)}`);
  const payouts = await view<any[]>(cfg.contract, "get_payouts", { plan_id: p.id, from_seq: Math.max(0, p.payout_count - 12), limit: 12 });
  if (payouts.length) {
    console.log("  recent payouts:");
    for (const o of payouts) console.log(`    #${o.seq} run ${o.run_index} ${o.recipient} ${f(o.amount)} ${o.status} @${new Date(o.timestamp * 1000).toISOString()}`);
  }
}
if (meta) {
  console.log("\nRecipient token balances:");
  for (const r of cfg.recipients) console.log(`  ${r}: ${fmt(await view<string>(cfg.token, "ft_balance_of", { account_id: r }))}`);
}
