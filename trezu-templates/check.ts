// Validate our manifests with Trezu's own parser and compile them with Trezu's own proposal
// engine (fetched by fetch-trezu.sh). With --submit, file the compiled "start recurring payroll"
// proposal on the demo DAO and approve it, proving a Trezu-built proposal creates a plan.
// Usage: tsx --tsconfig trezu-templates/tsconfig.json trezu-templates/check.ts [network] [--submit]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest } from "./.trezu-src/nt-fe/features/proposal-templates/manifest.ts";
import { buildTemplateProposal } from "./.trezu-src/nt-fe/features/proposal-templates/build-proposal.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const network = process.argv.find((a) => !a.startsWith("--") && !a.includes("/") && a !== process.argv[0] && a !== process.argv[1]) ?? "testnet";
const submit = process.argv.includes("--submit");
const dir = path.join(here, network);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

// Sample values a treasury member might type into the Trezu form.
const USD = 1_000_000n;
const samples: Record<string, Record<string, unknown>> = {
  "so-create-plan": {
    title: "Design retainer (filed from a Trezu template)",
    amount: (300n * USD).toString(),
    recipients: JSON.stringify([
      { account_id: "design.standing-order.testnet", amount: (100n * USD).toString() },
      { account_id: "dev2.standing-order.testnet", amount: (50n * USD).toString() },
    ]),
    interval_seconds: "120",
    cap_per_run: (150n * USD).toString(),
  },
  "so-top-up": { plan_id: "1", amount: (240n * USD).toString() },
  "so-pause": { plan_id: "1" },
  "so-resume": { plan_id: "1", skip_missed: true },
  "so-update-recipients": { plan_id: "1", recipients: JSON.stringify([{ account_id: "dev1.standing-order.testnet", amount: (10n * USD).toString() }]), cap_per_run: (10n * USD).toString() },
  "so-cancel": { plan_id: "1" },
};

const compiled: Record<string, any> = {};
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const parsed = parseManifest(raw);
  if (!parsed.success) {
    console.error(`✗ ${f}:`, parsed.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; "));
    process.exitCode = 1;
    continue;
  }
  const manifest = parsed.data;
  const proposal = buildTemplateProposal(manifest, samples[manifest.id] ?? {});
  const action = proposal.kind.FunctionCall.actions[0];
  const args = JSON.parse(Buffer.from(action.args, "base64").toString());
  compiled[manifest.id] = proposal;
  console.log(`✓ ${f} → ${proposal.kind.FunctionCall.receiver_id}.${action.method_name}(${JSON.stringify(args).slice(0, 140)}${JSON.stringify(args).length > 140 ? "…" : ""}) deposit=${action.deposit} gas=${action.gas}`);
  console.log(`    description: ${proposal.description}`);
  // The create-plan msg must itself be valid JSON the contract can parse.
  if (manifest.id === "so-create-plan" || manifest.id === "so-top-up") {
    const msg = JSON.parse(args.msg);
    if (!msg.action) throw new Error("msg lost its action");
  }
}

if (submit && process.exitCode !== 1) {
  const { account, cfg, log, view, TGAS, txLink } = await import("../scripts/lib/near.ts");
  const { vote, proposal: getProposal } = await import("../scripts/lib/dao.ts");
  const before = (await view<any>(cfg.contract, "get_config")).plan_count;
  const kind = compiled["so-create-plan"].kind;
  const policy = await view<any>(cfg.dao, "get_policy");
  const res = await account(cfg.council[0]).callFunctionRaw({
    contractId: cfg.dao,
    methodName: "add_proposal",
    args: { proposal: { description: compiled["so-create-plan"].description, kind } },
    gas: TGAS(100),
    deposit: BigInt(policy.proposal_bond),
  });
  const id = Number(Buffer.from((res.status as any).SuccessValue, "base64").toString());
  log("Trezu-compiled proposal filed", { id, tx: txLink(res.transaction.hash) });
  let p = await getProposal(id);
  for (const m of cfg.council) {
    if (p.status !== "InProgress") break;
    p = await vote(m, id);
  }
  const after = (await view<any>(cfg.contract, "get_config")).plan_count;
  if (p.status !== "Approved" || after !== before + 1) throw new Error(`expected a new plan: status=${p.status} plans ${before}→${after}`);
  const plan = await view<any>(cfg.contract, "get_plan", { plan_id: after });
  log("plan created from Trezu template", { plan_id: plan.id, title: plan.title, balance: plan.balance, recipients: plan.recipients.length, interval_seconds: plan.interval_seconds });
}
