// Generate Trezu custom-proposal templates for Standing Order.
// Usage: tsx trezu-templates/generate.ts [network=testnet]
// Env: SO_CONTRACT, SO_TOKEN (see ../.env.example). Output: trezu-templates/<network>/*.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const network = process.argv[2] ?? process.env.NEAR_NETWORK ?? "testnet";
const contract = process.env.SO_CONTRACT ?? (network === "mainnet" ? "standing-order.near" : "standing-order.testnet");
const token = process.env.SO_TOKEN ?? (network === "mainnet" ? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" : "usdc.fakes.testnet");
const symbol = process.env.SO_TOKEN_SYMBOL ?? (network === "mainnet" ? "USDC" : "USDC.e (testnet)");
const decimals = Number(process.env.SO_TOKEN_DECIMALS ?? 6);
const unitsHelp = `Base units: ${symbol} has ${decimals} decimals, so 100 ${symbol} = ${"1" + "0".repeat(decimals + 2)}.`;

const TGAS = (n: number) => `${n}000000000000`;
const planId = { name: "plan_id", label: "Plan id", type: "number", required: true, help: "Shown on the Standing Order dashboard and in plan_created events." };

export const manifests = [
  {
    version: 1,
    id: "so-create-plan",
    title: "Standing Order: start recurring payroll",
    summary: "Fund recurring payroll \"{{title}}\" with {{amount}} base units of " + symbol,
    binding: { receiver_id: token, method_name: "ft_transfer_call", deposit: "1", gas: TGAS(100) },
    fields: [
      { name: "title", label: "Plan title", type: "text", required: true, help: "No double quotes." },
      { name: "amount", label: `Initial funding (${symbol}, base units)`, type: "amount", required: true, help: unitsHelp },
      {
        name: "recipients",
        label: "Recipients (JSON)",
        type: "json",
        required: true,
        help: `Array of {"account_id":"alice.near","amount":"<base units>"}; amounts are paid every period.`,
      },
      { name: "interval_seconds", label: "Interval (seconds)", type: "number", required: true, default: 2592000, help: "2592000 = every 30 days. 604800 = weekly." },
      { name: "cap_per_run", label: `Maximum per run (${symbol}, base units)`, type: "amount", required: true, help: "Hard cap the contract enforces on every run; usually the sum of the recipients." },
    ],
    args: {
      receiver_id: contract,
      amount: "{{amount}}",
      msg: `{"action":"create_plan","plan":{"title":"{{title}}","asset":{"Ft":{"contract":"${token}"}},"recipients":{{recipients}},"interval_seconds":{{interval_seconds}},"cap_per_run":"{{cap_per_run}}"}}`,
    },
  },
  {
    version: 1,
    id: "so-top-up",
    title: "Standing Order: top up a payroll plan",
    summary: "Top up Standing Order plan #{{plan_id}} with {{amount}} base units of " + symbol,
    binding: { receiver_id: token, method_name: "ft_transfer_call", deposit: "1", gas: TGAS(100) },
    fields: [planId, { name: "amount", label: `Amount (${symbol}, base units)`, type: "amount", required: true, help: unitsHelp }],
    args: { receiver_id: contract, amount: "{{amount}}", msg: `{"action":"fund_plan","plan_id":{{plan_id}}}` },
  },
  {
    version: 1,
    id: "so-pause",
    title: "Standing Order: pause a payroll plan",
    summary: "Pause Standing Order plan #{{plan_id}}",
    binding: { receiver_id: contract, method_name: "pause_plan", deposit: "0", gas: TGAS(30) },
    fields: [planId],
    args: { plan_id: "{{plan_id}}" },
  },
  {
    version: 1,
    id: "so-resume",
    title: "Standing Order: resume a payroll plan",
    summary: "Resume Standing Order plan #{{plan_id}}",
    binding: { receiver_id: contract, method_name: "resume_plan", deposit: "0", gas: TGAS(30) },
    fields: [planId, { name: "skip_missed", label: "Skip periods missed while paused (no back pay)", type: "bool", default: false }],
    args: { plan_id: "{{plan_id}}", skip_missed: "{{skip_missed}}" },
  },
  {
    version: 1,
    id: "so-update-recipients",
    title: "Standing Order: change recipients or cap",
    summary: "Update recipients of Standing Order plan #{{plan_id}}",
    binding: { receiver_id: contract, method_name: "update_plan", deposit: "10000000000000000000000", gas: TGAS(30) },
    fields: [
      planId,
      { name: "recipients", label: "New recipients (JSON)", type: "json", required: true, help: `Array of {"account_id":"alice.near","amount":"<base units>"}.` },
      { name: "cap_per_run", label: `Maximum per run (${symbol}, base units)`, type: "amount", required: true },
    ],
    args: { plan_id: "{{plan_id}}", update: { recipients: "{{recipients}}", cap_per_run: "{{cap_per_run}}" } },
  },
  {
    version: 1,
    id: "so-cancel",
    title: "Standing Order: cancel a plan and return funds",
    summary: "Cancel Standing Order plan #{{plan_id}} and sweep its balance back to the treasury",
    binding: { receiver_id: contract, method_name: "cancel_plan", deposit: "0", gas: TGAS(100) },
    fields: [planId],
    args: { plan_id: "{{plan_id}}" },
  },
];

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), network);
fs.mkdirSync(outDir, { recursive: true });
for (const m of manifests) {
  fs.writeFileSync(path.join(outDir, `${m.id}.json`), JSON.stringify(m, null, 2) + "\n");
}
console.log(`wrote ${manifests.length} manifests for ${network} (${contract}, ${token}) to ${outDir}`);
