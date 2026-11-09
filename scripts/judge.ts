// Zero-key, zero-funds verification of the Standing Order deployment and its offline proofs.
//
// Run with `npm run judge` on a fresh clone after `npm ci`. Needs outbound HTTPS to the NEAR
// testnet RPC (checks 1-3) and, optionally, to NEAR AI Cloud (check 6, skipped if unreachable).
// Checks 4 and 5 are fully offline. Exits non-zero if any check fails. See docs/JUDGE.md.
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import { verifyMessage } from "ethers";
import { cfg, RPC_URL, view } from "./lib/near.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ONE_CLICK_MANAGER_PUB_KEY = "reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc"; // contract/src/routes.rs
const MAX_PAYOUT_AGE_MIN = 180;
const NEARAI_BASE_URL = process.env.NEARAI_CLOUD_BASE_URL ?? "https://cloud-api.near.ai";

type Outcome = "ok" | "FAIL" | "skip";
const results: { outcome: Outcome; title: string }[] = [];
let n = 0;

function report(outcome: Outcome, title: string, lines: string[] = []) {
  n += 1;
  results.push({ outcome, title });
  console.log(`${String(n).padStart(2)}. [${outcome}] ${title}`);
  for (const l of lines) console.log(`       ${l}`);
}

/** Run one check; any thrown error is a FAIL with the message as evidence. */
async function check(title: string, fn: () => Promise<{ outcome?: Outcome; lines: string[] }>) {
  try {
    const r = await fn();
    report(r.outcome ?? "ok", title, r.lines);
  } catch (e) {
    report("FAIL", title, String(e instanceof Error ? e.message : e).split("\n").filter(Boolean));
  }
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "judge", method, params }) });
  if (!r.ok) throw new Error(`RPC ${r.status}`);
  const j: any = await r.json();
  if (j.error) throw new Error(`RPC error: ${JSON.stringify(j.error).slice(0, 200)}`);
  return j.result as T;
}

const formatAmount = (base: string, decimals: number, symbol: string) => {
  const u = 10n ** BigInt(decimals);
  const v = BigInt(base);
  const frac = (v % u).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / u}${frac ? "." + frac : ""} ${symbol}`;
};

console.log(`judge: contract ${cfg.contract} | rpc ${RPC_URL} | ${new Date().toISOString()}\n`);

// ── 1. live contract ───────────────────────────────────────────────────────────────────────────
let plans: any[] = [];
await check(`live contract ${cfg.contract} answers get_plans`, async () => {
  plans = await view<any[]>(cfg.contract, "get_plans", { from_index: 0, limit: 50 });
  if (!Array.isArray(plans)) throw new Error("get_plans did not return an array");
  const active = plans.filter((p) => p.status === "Active").length;
  if (plans.length === 0) throw new Error("no plans on the contract");
  return { lines: [`plans: ${plans.length}, active: ${active}, owners: ${[...new Set(plans.map((p) => p.owner))].join(", ")}`] };
});

// ── 2. latest payout ───────────────────────────────────────────────────────────────────────────
await check(`latest payout is younger than ${MAX_PAYOUT_AGE_MIN} minutes`, async () => {
  if (!plans.length) throw new Error("no plans (check 1 failed)");
  let latest: any = null;
  for (const p of plans) {
    if (!p.payout_count) continue;
    const from = Math.max(0, p.payout_count - 10);
    const recent = await view<any[]>(cfg.contract, "get_payouts", { plan_id: p.id, from_seq: from, limit: p.payout_count - from });
    for (const o of recent) if (!latest || o.timestamp > latest.timestamp) latest = { ...o, plan: p };
  }
  if (!latest) throw new Error("no payouts recorded on any plan");
  const asset = latest.plan.asset;
  let amount: string;
  if (typeof asset === "object" && asset.Ft) {
    const meta = await view<any>(asset.Ft.contract, "ft_metadata");
    amount = formatAmount(latest.amount, meta.decimals, meta.symbol);
  } else {
    amount = formatAmount(latest.amount, 24, "NEAR");
  }
  const ageMin = (Date.now() / 1000 - latest.timestamp) / 60;
  const lines = [
    `plan #${latest.plan.id} seq ${latest.seq} run ${latest.run_index}: ${latest.recipient} received ${amount} (${latest.status})`,
    `at ${new Date(latest.timestamp * 1000).toISOString()}, ${ageMin.toFixed(1)} min ago, block ${latest.block_height}`,
  ];
  if (ageMin >= MAX_PAYOUT_AGE_MIN) throw new Error(`${lines.join("; ")}; older than ${MAX_PAYOUT_AGE_MIN} min`);
  if (latest.status === "Failed") throw new Error(`${lines.join("; ")}; latest payout failed`);
  return { lines };
});

// ── 3. keeper keys ─────────────────────────────────────────────────────────────────────────────
// Every account that triggers paydays (the GitHub Actions keeper and the reference keeper) must hold
// nothing but run_due-only function-call keys: no FullAccess key, no other receiver, no other method.
const KEEPER_ACCOUNTS = (process.env.KEEPER_ACCOUNTS ?? `${cfg.keeper},keeper2.standing-order.testnet`).split(",").map((a) => a.trim()).filter(Boolean);
await check(`keeper account(s) ${KEEPER_ACCOUNTS.join(", ")} hold only run_due function-call keys`, async () => {
  const lines: string[] = [];
  let bad = 0;
  let total = 0;
  for (const acct of KEEPER_ACCOUNTS) {
    const res = await rpc<{ keys: any[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: acct });
    if (!res.keys.length) throw new Error(`${acct} has no access keys`);
    total += res.keys.length;
    for (const k of res.keys) {
      const perm = k.access_key.permission;
      const fc = perm?.FunctionCall;
      const ok = fc && fc.receiver_id === cfg.contract && Array.isArray(fc.method_names) && fc.method_names.length === 1 && fc.method_names[0] === "run_due";
      if (!ok) bad += 1;
      const desc = fc ? `FunctionCall ${fc.receiver_id}::[${fc.method_names.join(",")}] allowance ${fc.allowance ? formatAmount(fc.allowance, 24, "NEAR") : "unlimited"}` : JSON.stringify(perm);
      lines.push(`${ok ? "ok " : "BAD"} ${acct} ${k.public_key}: ${desc}`);
    }
  }
  if (bad) throw new Error(`${bad} of ${total} keys are broader than ${cfg.contract}::run_due\n` + lines.join("\n"));
  return { lines: [`${total} key(s) across ${KEEPER_ACCOUNTS.length} account(s), all restricted to ${cfg.contract}::run_due`, ...lines] };
});

// ── 4. 1Click quote signature (offline) ────────────────────────────────────────────────────────
// Mirrors contract/src/routes.rs `signed_message` and the 1Click SDK's `quoteHash`:
// json-stable-stringify({...signedRequestFields, ...signedQuoteFields, timestamp}) → sha256 → base58.
function signedMessage(req: any, quote: any, timestamp: string): string {
  const truthy = (v: unknown) => (typeof v === "number" ? v !== 0 : Boolean(v));
  const fields: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => { if (v !== undefined && v !== null) fields[k] = v; };
  for (const k of ["dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline"]) put(k, req[k]);
  for (const k of ["quoteWaitingTimeMs", "referral", "virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"]) if (truthy(req[k])) put(k, req[k]);
  for (const k of ["amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut"]) put(k, quote[k]);
  if (req.dry === false) for (const k of ["depositAddress", "depositMemo", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"]) if (truthy(quote[k])) put(k, quote[k]); // quote.deadline overrides request.deadline
  fields.timestamp = timestamp;
  const json = "{" + Object.keys(fields).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(fields[k])}`).join(",") + "}";
  return bs58.encode(createHash("sha256").update(json, "utf8").digest());
}

await check("1Click quote fixture verifies against the 1Click manager key (offline, ed25519)", async () => {
  const file = path.join(ROOT, "contract/tests/fixtures/quote_live.json");
  const q = JSON.parse(fs.readFileSync(file, "utf8"));
  const message = signedMessage(q.quoteRequest, q.quote, q.timestamp);
  const sig = bs58.decode(String(q.signature).replace(/^ed25519:/, ""));
  const pk = bs58.decode(ONE_CLICK_MANAGER_PUB_KEY);
  if (sig.length !== 64 || pk.length !== 32) throw new Error(`bad lengths: sig ${sig.length}, pk ${pk.length}`);
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pk).toString("base64url") }, format: "jwk" });
  const ok = cryptoVerify(null, Buffer.from(message, "utf8"), key, sig);
  const lines = [
    `fixture ${path.relative(ROOT, file)}: ${q.quoteRequest.amount} ${q.quoteRequest.originAsset.slice(0, 24)}… → ${q.quoteRequest.recipient} on ${q.quoteRequest.destinationAsset}`,
    `signed message base58(sha256(stable_json)) = ${message}`,
    `signature ${String(q.signature).slice(0, 28)}… key ed25519:${ONE_CLICK_MANAGER_PUB_KEY}`,
  ];
  if (!ok) throw new Error(lines.join("; ") + "; signature does NOT verify");
  // A one-byte change to the deposit address must break it, as the contract's tests require.
  const tampered = signedMessage(q.quoteRequest, { ...q.quote, depositAddress: "attacker.near" }, q.timestamp);
  if (cryptoVerify(null, Buffer.from(tampered, "utf8"), key, sig)) throw new Error("tampered deposit address still verifies");
  lines.push("tampered depositAddress → signature rejected");
  return { lines };
});

// ── 5. clerk receipts (offline) ────────────────────────────────────────────────────────────────
// Mirrors the `provider_tee` branch of clerk/src/nearai.ts, replaying it from the stored receipt:
// signed text must equal `<model>:<request_hash>:<response_hash>`, the EIP-191 signer recovered
// from the signature must equal the stored recovered_signer and appear exactly once among the
// attestation's model signing addresses, and the attestation nonce must have been echoed.
await check("clerk receipts re-verify offline (EIP-191 signer = attested NEAR AI TEE)", async () => {
  const dir = path.join(ROOT, "clerk/reviews");
  const files = fs.readdirSync(dir).filter((f) => /^(proposal|draft)-.*\.json$/.test(f)).sort();
  if (!files.length) throw new Error("no clerk/reviews/*.json receipts");
  const lines: string[] = [];
  const failures: string[] = [];
  for (const f of files) {
    const review = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const rc = review.receipt;
    const problems: string[] = [];
    if (!rc?.signature) { failures.push(`${f}: no signature in receipt`); continue; }
    const expectedText = `${rc.model}:${rc.request_hash}:${rc.response_hash}`;
    const textOk = rc.signature.signature_kind === "provider_tee" && rc.signature.text === expectedText;
    if (!textOk) problems.push("signed text != model:request_hash:response_hash");
    let recovered = "";
    try { recovered = verifyMessage(rc.signature.text, rc.signature.signature).toLowerCase(); } catch (e) { problems.push(`recovery failed: ${String(e).slice(0, 60)}`); }
    if (recovered !== String(rc.recovered_signer).toLowerCase()) problems.push(`recovered ${recovered} != stored ${rc.recovered_signer}`);
    const attested: string[] = (rc.attestation?.model_signing_addresses ?? []).map((a: string) => a.toLowerCase());
    if (attested.filter((a) => a === recovered).length !== 1) problems.push(`signer not among attested model TEEs [${attested.join(",")}]`);
    if (rc.attestation?.nonce_echoed !== true) problems.push("attestation nonce not echoed");
    if (rc.verified !== true) problems.push("receipt stored verified=false");
    const line = `${f}: ${review.type} ${rc.model} chat ${rc.chat_id} signer ${recovered}`;
    if (problems.length) failures.push(`${line}: ${problems.join("; ")}`); else lines.push(line);
  }
  if (failures.length) throw new Error(`${failures.length}/${files.length} receipts failed\n` + [...failures, ...lines].join("\n"));
  return { lines: [`${files.length} receipts, all signed by an attested model TEE`, ...lines] };
});

// ── 6. NEAR AI attestation (live, optional) ────────────────────────────────────────────────────
await check("NEAR AI Cloud attestation report is served for the clerk's model (live, optional)", async () => {
  const dir = path.join(ROOT, "clerk/reviews");
  const first = fs.readdirSync(dir).filter((f) => /^(proposal|draft)-.*\.json$/.test(f)).sort()[0];
  const review = first ? JSON.parse(fs.readFileSync(path.join(dir, first), "utf8")) : null;
  const model: string = review?.receipt?.model ?? "Qwen/Qwen3.8-27B";
  const storedSigners: string[] = (review?.receipt?.attestation?.model_signing_addresses ?? []).map((a: string) => a.toLowerCase());
  const nonce = createHash("sha256").update(String(Date.now())).digest("hex");
  const params = new URLSearchParams({ model, provider: "near", nonce, signing_algo: "ecdsa", include_tls_fingerprint: "false" });
  let r: Response;
  try {
    r = await fetch(`${NEARAI_BASE_URL}/v1/attestation/report?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { outcome: "skip", lines: [`no network to ${NEARAI_BASE_URL} (${String(e).slice(0, 60)}); the offline receipt check above does not depend on it`] };
  }
  if (r.status === 401 || r.status === 403) return { outcome: "skip", lines: [`attestation endpoint now requires a key (HTTP ${r.status}); never required by this check`] };
  if (!r.ok) return { outcome: "skip", lines: [`attestation endpoint answered HTTP ${r.status}; skipped`] };
  const report: any = await r.json();
  const models: any[] = report.model_attestations ?? [];
  const signers = models.map((m) => String(m.signing_address).toLowerCase());
  const echoed = models.every((m) => m.request_nonce === nonce);
  const lines = [
    `model ${model}: ${models.length} model attestation(s), signing ${signers.join(", ") || "none"}; gateway ${report.gateway_attestation?.signing_address ?? "none"}`,
    `fresh nonce echoed: ${echoed}; intel_quote: ${models.some((m) => m.intel_quote) ? "yes" : "no"}; nvidia_payload: ${models.some((m) => m.nvidia_payload) ? "yes" : "no"}`,
  ];
  const overlap = storedSigners.filter((s) => signers.includes(s));
  lines.push(overlap.length ? `receipt signer ${overlap.join(", ")} is still an attested TEE for this model` : `receipt signers ${storedSigners.join(", ")} are not in today's report (TEE keys rotate; receipts bind to the report fetched at signing time)`);
  if (!models.length || !echoed) throw new Error(lines.join("; "));
  return { lines };
});

// ── summary ────────────────────────────────────────────────────────────────────────────────────
const ok = results.filter((r) => r.outcome === "ok").length;
const failed = results.filter((r) => r.outcome === "FAIL").length;
const skipped = results.filter((r) => r.outcome === "skip").length;
console.log(`\njudge: ${results.length} checks, ${ok} ok${failed ? `, ${failed} FAIL` : ""}${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(failed ? 1 : 0);
