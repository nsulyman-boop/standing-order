// Trigger due runs once, as the keeper account. Usage: npm run run-due -- [plan_id]
import { account, cfg, log, TGAS, txLink, view } from "./lib/near.ts";

const keeper = account(cfg.keeper);
const arg = process.argv[2];
const due: number[] = arg ? [Number(arg)] : await view<number[]>(cfg.contract, "get_due_plans", { limit: 20 });
if (due.length === 0) {
  log("nothing due", { now: await view(cfg.contract, "now_seconds") });
}
for (const plan_id of due) {
  const res = await keeper.callFunctionRaw({ contractId: cfg.contract, methodName: "run_due", args: { plan_id }, gas: TGAS(300) });
  const outcome = JSON.parse(Buffer.from((res.status as any).SuccessValue, "base64").toString());
  log(`run_due(${plan_id})`, { outcome, tx: txLink(res.transaction.hash) });
}
