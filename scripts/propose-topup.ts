// A council member proposes topping up an existing plan from the DAO treasury.
// Usage: tsx scripts/propose-topup.ts [amount=1200] [plan_id=1]
import { cfg, log, TGAS, view } from "./lib/near.ts";
import { proposeFunctionCall } from "./lib/dao.ts";
const meta = await view<any>(cfg.token, "ft_metadata");
const amount = (BigInt(process.argv[2] ?? "1200") * 10n ** BigInt(meta.decimals)).toString();
const id = await proposeFunctionCall(cfg.council[0], cfg.token, [{ method_name: "ft_transfer_call", args: { receiver_id: cfg.contract, amount, msg: JSON.stringify({ action: "fund_plan", plan_id: Number(process.argv[3] ?? 1) }) }, deposit: "1", gas: TGAS(100).toString() }], `Standing Order: top up plan #${process.argv[3] ?? 1} with ${process.argv[2] ?? "1200"} ${meta.symbol}`);
log("top-up proposal", id);
console.log(id);
