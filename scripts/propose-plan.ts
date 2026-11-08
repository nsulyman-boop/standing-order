// A council member proposes: "transfer N tokens from the DAO into a new Standing Order plan".
// The proposal is a FunctionCall on the token contract (ft_transfer_call with a create_plan msg),
// which is the same shape Trezu's custom proposal templates file.
import { cfg, log, TGAS, view } from "./lib/near.ts";
import { proposeFunctionCall } from "./lib/dao.ts";

const meta = await view<any>(cfg.token, "ft_metadata");
const units = 10n ** BigInt(meta.decimals);
const interval = Number(process.env.SO_INTERVAL ?? 120);
const amounts = (process.env.SO_AMOUNTS ?? "100,80,60").split(",").map((a) => BigInt(a) * units);
const runs = BigInt(process.env.SO_RUNS ?? 5);
const perRun = amounts.reduce((a, b) => a + b, 0n);
const fund = perRun * runs;

const plan = {
  title: process.env.SO_TITLE ?? "Core contributors, every 2 minutes (demo)",
  asset: { Ft: { contract: cfg.token } },
  recipients: cfg.recipients.map((account_id, i) => ({ account_id, amount: amounts[i].toString() })),
  interval_seconds: interval,
  start_at: null,
  end_at: null,
  cap_per_run: perRun.toString(),
};
const msg = JSON.stringify({ action: "create_plan", plan });
log("proposing plan", { fund: `${Number(fund) / Number(units)} ${meta.symbol}`, per_run: `${Number(perRun) / Number(units)} ${meta.symbol}`, interval_seconds: interval, recipients: cfg.recipients });
const id = await proposeFunctionCall(
  cfg.council[0],
  cfg.token,
  [{ method_name: "ft_transfer_call", args: { receiver_id: cfg.contract, amount: fund.toString(), msg }, deposit: "1", gas: TGAS(100).toString() }],
  `Standing Order: fund payroll plan "${plan.title}" with ${Number(fund) / Number(units)} ${meta.symbol} (${runs} runs of ${Number(perRun) / Number(units)})`,
);
console.log(`\nProposal #${id} is open. Approve it with: npm run vote -- ${id}`);
