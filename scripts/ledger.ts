// Export every payout recorded on the live contract as an accountant-friendly ledger.
//
//   npm run ledger                      CSV to stdout
//   npm run ledger -- --out ledger.csv  CSV to a file
//   npm run ledger -- --json            JSON array instead of CSV
//
// Needs no keys and no funds: only view calls to the testnet RPC (NODE_USE_ENV_PROXY=1 behind a proxy).
// Fields come from PayoutRecord / RouteRecord in contract/src/types.rs.
import fs from "node:fs";
import { cfg, view } from "./lib/near.ts";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
if (outIdx >= 0 && !outFile) { console.error("--out needs a file name"); process.exit(2); }

const PAGE = 100;
const CONCURRENCY = 8;

interface Row {
  date: string; plan_id: number; plan_title: string; seq: number; run_index: number; recipient: string;
  amount: string; amount_base_units: string; token_symbol: string; token_contract: string; status: string;
  route: string; route_destination_asset: string; route_destination_address: string; route_deposit_address: string;
  route_amount_out: string; route_correlation_id: string; source_dao: string; block_height: number;
}

const formatAmount = (base: string, decimals: number) => {
  const u = 10n ** BigInt(decimals);
  const v = BigInt(base);
  const frac = (v % u).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / u}${frac ? "." + frac : ""}`;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

const plans = await view<any[]>(cfg.contract, "get_plans", { from_index: 0, limit: 500 });
const metaCache = new Map<string, { symbol: string; decimals: number }>();
async function tokenMeta(asset: any): Promise<{ symbol: string; decimals: number; contract: string }> {
  if (typeof asset !== "object" || !asset.Ft) return { symbol: "NEAR", decimals: 24, contract: "near" };
  const contract: string = asset.Ft.contract;
  if (!metaCache.has(contract)) {
    const m = await view<any>(contract, "ft_metadata").catch(() => ({ symbol: contract, decimals: 0 }));
    metaCache.set(contract, { symbol: m.symbol, decimals: m.decimals });
  }
  return { ...metaCache.get(contract)!, contract };
}

const rows: Row[] = [];
for (const p of plans) {
  const meta = await tokenMeta(p.asset);
  const payouts: any[] = [];
  for (let from = 0; from < p.payout_count; from += PAGE) {
    payouts.push(...(await view<any[]>(cfg.contract, "get_payouts", { plan_id: p.id, from_seq: from, limit: PAGE })));
  }
  const routes = await mapLimit(payouts, CONCURRENCY, (o) => view<any | null>(cfg.contract, "get_route", { plan_id: p.id, seq: o.seq }).catch(() => null));
  payouts.forEach((o, i) => {
    const r = routes[i];
    rows.push({
      date: new Date(o.timestamp * 1000).toISOString(),
      plan_id: p.id,
      plan_title: p.title,
      seq: o.seq,
      run_index: o.run_index,
      recipient: o.recipient,
      amount: formatAmount(o.amount, meta.decimals),
      amount_base_units: o.amount,
      token_symbol: meta.symbol,
      token_contract: meta.contract,
      status: o.status,
      route: r ? `${r.destination_asset} → ${r.destination_address}` : "near",
      route_destination_asset: r?.destination_asset ?? "",
      route_destination_address: r?.destination_address ?? "",
      route_deposit_address: r?.deposit_address ?? "",
      route_amount_out: r ? formatAmount(r.amount_out, meta.decimals) : "",
      route_correlation_id: r?.correlation_id ?? "",
      source_dao: p.owner,
      block_height: o.block_height,
    });
  });
}
rows.sort((a, b) => a.date.localeCompare(b.date) || a.plan_id - b.plan_id || a.seq - b.seq);

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const columns = ["date", "plan_id", "plan_title", "seq", "run_index", "recipient", "amount", "token_symbol", "token_contract", "status", "route", "route_destination_asset", "route_destination_address", "route_deposit_address", "route_amount_out", "route_correlation_id", "source_dao", "amount_base_units", "block_height"] as const;
const text = asJson
  ? JSON.stringify(rows, null, 2) + "\n"
  : [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";

if (outFile) {
  fs.writeFileSync(outFile, text);
  console.error(`ledger: ${rows.length} payouts across ${plans.length} plans on ${cfg.contract} written to ${outFile}`);
} else {
  process.stdout.write(text);
}
