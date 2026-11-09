// A council member proposes a management call on a plan: pause_plan | resume_plan | cancel_plan | sweep | update_plan.
// Usage: npm run propose:call -- pause_plan '{"plan_id":1}' [deposit_near]
// update_plan needs a small deposit when the plan grows (longer title, more recipients): pass e.g. 0.01.
// Note: Sputnik marks a proposal Approved even if the inner call panics, so check the effect with `npm run status`.
import { cfg, NEAR, TGAS } from "./lib/near.ts";
import { proposeFunctionCall } from "./lib/dao.ts";

const [method, argsJson, depositNear] = process.argv.slice(2);
if (!method) {
  console.error("usage: propose-call.ts <method> '<json args>'");
  process.exit(1);
}
const args = JSON.parse(argsJson ?? "{}");
const id = await proposeFunctionCall(cfg.council[0], cfg.contract, [{ method_name: method, args, deposit: depositNear ? NEAR(depositNear).toString() : "0", gas: TGAS(100).toString() }], `Standing Order: ${method} ${argsJson ?? ""}`);
console.log(`\nProposal #${id} is open. Approve it with: npm run vote -- ${id}`);
