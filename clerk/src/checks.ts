// Deterministic payroll checks. These run before and independently of the model, and are always
// included in the review, so the model can explain findings but never hide them.
export interface RecipientIn { account_id: string; amount: string }
export interface Finding { level: "block" | "warn" | "info"; code: string; message: string; recipient?: string }

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function checkProposal(args: {
  recipients: RecipientIn[];
  decimals: number;
  symbol: string;
  capPerRun?: string;
  balance?: string;
  intervalSeconds?: number;
  previous?: RecipientIn[];
  knownAccounts?: string[];
  fundAmount?: string;
}): Finding[] {
  const f: Finding[] = [];
  const unit = 10n ** BigInt(args.decimals);
  const seen = new Set<string>();
  let total = 0n;
  for (const r of args.recipients) {
    const amt = safeBig(r.amount);
    if (!ACCOUNT_RE.test(r.account_id) || r.account_id.length < 2 || r.account_id.length > 64) f.push({ level: "block", code: "bad_account", message: `"${r.account_id}" is not a valid NEAR account id`, recipient: r.account_id });
    if (seen.has(r.account_id)) f.push({ level: "block", code: "duplicate", message: `${r.account_id} appears more than once; it would be paid twice per run`, recipient: r.account_id });
    seen.add(r.account_id);
    if (amt === null || amt <= 0n) f.push({ level: "block", code: "bad_amount", message: `${r.account_id}: amount "${r.amount}" is not a positive integer in base units`, recipient: r.account_id });
    else {
      total += amt;
      const human = Number(amt) / Number(unit);
      if (human >= 1_000_000) f.push({ level: "block", code: "units", message: `${r.account_id}: ${human.toLocaleString()} ${args.symbol} per run looks like a decimals slip (${args.symbol} has ${args.decimals} decimals; 100 ${args.symbol} = ${(100n * unit).toString()} base units)`, recipient: r.account_id });
      else if (human >= 50_000) f.push({ level: "warn", code: "large", message: `${r.account_id}: ${human.toLocaleString()} ${args.symbol} per run is unusually large`, recipient: r.account_id });
      if (amt < unit / 100n) f.push({ level: "warn", code: "dust", message: `${r.account_id}: ${human} ${args.symbol} per run is below 0.01; probably missing decimals`, recipient: r.account_id });
    }
  }
  if (args.recipients.length === 0) f.push({ level: "block", code: "empty", message: "No recipients" });
  if (args.capPerRun !== undefined) {
    const cap = safeBig(args.capPerRun);
    if (cap === null || cap < total) f.push({ level: "block", code: "cap", message: `cap_per_run (${fmt(cap, unit)} ${args.symbol}) is below the recipients total (${fmt(total, unit)} ${args.symbol}); every run would fail` });
    else if (cap > total * 3n) f.push({ level: "warn", code: "cap_loose", message: `cap_per_run (${fmt(cap, unit)} ${args.symbol}) is more than 3× the run total; a later recipients update could triple payroll without a cap change` });
  }
  if (args.intervalSeconds !== undefined) {
    if (args.intervalSeconds < 86_400) f.push({ level: "info", code: "cadence", message: `Cadence is every ${args.intervalSeconds}s (${(args.intervalSeconds / 60).toFixed(0)} min): fine for a demo, unusual for payroll` });
  }
  const funding = args.fundAmount !== undefined ? safeBig(args.fundAmount) : args.balance !== undefined ? safeBig(args.balance) : null;
  if (funding !== null && total > 0n) {
    const runs = funding / total;
    if (runs === 0n) f.push({ level: "block", code: "underfunded", message: `Funding ${fmt(funding, unit)} ${args.symbol} does not cover one run of ${fmt(total, unit)} ${args.symbol}` });
    else f.push({ level: "info", code: "runway", message: `Funding covers ${runs} run${runs === 1n ? "" : "s"} (${fmt(funding, unit)} / ${fmt(total, unit)} ${args.symbol})` });
    if (funding % total !== 0n) f.push({ level: "info", code: "remainder", message: `${fmt(funding % total, unit)} ${args.symbol} would sit unused after the last full run; the DAO can sweep it` });
  }
  if (args.previous) {
    const prev = new Map(args.previous.map((r) => [r.account_id, safeBig(r.amount) ?? 0n]));
    for (const r of args.recipients) {
      const amt = safeBig(r.amount) ?? 0n;
      const old = prev.get(r.account_id);
      if (old === undefined) f.push({ level: "warn", code: "new_recipient", message: `${r.account_id} is new on this plan (${fmt(amt, unit)} ${args.symbol} per run)`, recipient: r.account_id });
      else if (old > 0n && amt * 100n > old * 150n) f.push({ level: "warn", code: "raise", message: `${r.account_id}: ${fmt(old, unit)} → ${fmt(amt, unit)} ${args.symbol} (+${Number((amt - old) * 100n / old)}%)`, recipient: r.account_id });
      else if (old > 0n && amt * 100n < old * 50n) f.push({ level: "warn", code: "cut", message: `${r.account_id}: ${fmt(old, unit)} → ${fmt(amt, unit)} ${args.symbol} (${Number((amt - old) * 100n / old)}%)`, recipient: r.account_id });
    }
    for (const [acc] of prev) if (!seen.has(acc)) f.push({ level: "warn", code: "removed", message: `${acc} is removed from the plan`, recipient: acc });
  }
  if (args.knownAccounts) {
    const known = new Set(args.knownAccounts);
    for (const r of args.recipients) if (!known.has(r.account_id)) f.push({ level: "warn", code: "unknown_account", message: `${r.account_id} is not in the known contributor list`, recipient: r.account_id });
  }
  return f;
}

export function verdict(findings: Finding[]): "block" | "warn" | "ok" {
  if (findings.some((x) => x.level === "block")) return "block";
  if (findings.some((x) => x.level === "warn")) return "warn";
  return "ok";
}

function safeBig(v: string | undefined): bigint | null {
  try { return v !== undefined && /^\d+$/.test(v) ? BigInt(v) : null; } catch { return null; }
}
function fmt(v: bigint | null, unit: bigint): string {
  if (v === null) return "?";
  const whole = v / unit; const frac = v % unit;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(unit.toString().length - 1, "0").replace(/0+$/, "")}`;
}
