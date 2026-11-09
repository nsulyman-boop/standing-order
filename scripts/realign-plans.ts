// One DAO proposal per plan: pause → set interval → resume with skip_missed (no back pay).
// Usage: tsx scripts/realign-plans.ts <plan_id>:<interval_seconds> [...]
import { cfg, TGAS } from "./lib/near.ts";
import { proposeFunctionCall, vote, proposal } from "./lib/dao.ts";

for (const spec of process.argv.slice(2)) {
  const [plan_id, interval] = spec.split(":").map(Number);
  const gas = TGAS(60).toString();
  const id = await proposeFunctionCall(
    cfg.council[0],
    cfg.contract,
    [
      { method_name: "pause_plan", args: { plan_id }, gas },
      { method_name: "update_plan", args: { plan_id, update: { interval_seconds: interval } }, gas },
      { method_name: "resume_plan", args: { plan_id, skip_missed: true }, gas },
    ],
    `Standing Order: realign plan #${plan_id} to every ${interval}s, skipping missed periods`,
  );
  let p = await proposal(id);
  for (const m of cfg.council) {
    if (p.status !== "InProgress") break;
    p = await vote(m, id);
  }
  console.log(`plan #${plan_id}: proposal #${id} ${p.status}`);
}
