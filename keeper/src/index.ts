// Standing Order keeper.
//
// Every POLL_SECONDS it asks the contract which plans are due and calls `run_due` on each,
// repeating while a large run is split across calls. It signs with a function-call access key that
// can only call `run_due` on the contract, so a compromised keeper can trigger payroll early by at
// most one polling interval, and can never redirect funds or change a plan.
//
// Config (keeper/.env or environment): NEAR_NETWORK, NEAR_RPC_URL, SO_CONTRACT, KEEPER_ACCOUNT,
// KEEPER_KEY (ed25519:...), POLL_SECONDS (default 15), KEEPER_HTTP_PORT (optional status endpoint).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(here, "..", ".env"));

const NETWORK = process.env.NEAR_NETWORK ?? "testnet";
const RPC_URL = process.env.NEAR_RPC_URL ?? (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
const CONTRACT = must("SO_CONTRACT");
const KEEPER_ACCOUNT = must("KEEPER_ACCOUNT");
const KEEPER_KEY = must("KEEPER_KEY") as KeyPairString;
const POLL_SECONDS = Number(process.env.POLL_SECONDS ?? 15);
const ONCE = process.argv.includes("--once");
const LOG_FILE = process.env.KEEPER_LOG ?? path.join(here, "..", "data", "runs.jsonl");
const TGAS_300 = 300n * 10n ** 12n;

const provider = new JsonRpcProvider({ url: RPC_URL });
const keeper = new Account(KEEPER_ACCOUNT, provider, KEEPER_KEY);

type Outcome = "Paused" | "Cancelled" | "Ended" | { NotDue: { next_run_at: number } } | { Underfunded: { needed: string; balance: string } } | { Sent: { run_index: number; sent: number; remaining: number; completed: boolean } };

const state = {
  startedAt: new Date().toISOString(),
  ticks: 0,
  runs: 0,
  payoutsSent: 0,
  lastTick: null as string | null,
  lastError: null as string | null,
  recent: [] as Array<Record<string, unknown>>,
};

async function tick(): Promise<void> {
  state.ticks += 1;
  state.lastTick = new Date().toISOString();
  const due = (await provider.callFunction<number[]>({ contractId: CONTRACT, method: "get_due_plans", args: { limit: 20 } })) ?? [];
  if (due.length === 0) {
    log("idle", { due: 0 });
    return;
  }
  for (const planId of due) {
    // A run with many recipients is paid over several calls; keep going until it completes.
    for (let i = 0; i < 20; i++) {
      const res = await keeper.callFunctionRaw({ contractId: CONTRACT, methodName: "run_due", args: { plan_id: planId }, gas: TGAS_300 });
      const outcome = decode<Outcome>(res);
      const entry = { at: new Date().toISOString(), plan_id: planId, outcome, tx: res.transaction.hash };
      record(entry);
      if (typeof outcome === "object" && "Sent" in outcome) {
        state.payoutsSent += outcome.Sent.sent;
        if (outcome.Sent.completed) state.runs += 1;
        log("sent", entry);
        if (outcome.Sent.completed) break;
        continue;
      }
      log("skipped", entry);
      break;
    }
  }
}

async function main(): Promise<void> {
  log("keeper starting", { network: NETWORK, rpc: RPC_URL, contract: CONTRACT, account: KEEPER_ACCOUNT, pollSeconds: POLL_SECONDS, once: ONCE });
  await assertKeyIsRestricted();
  if (process.env.KEEPER_HTTP_PORT) startStatusServer(Number(process.env.KEEPER_HTTP_PORT));
  let backoff = POLL_SECONDS;
  for (;;) {
    try {
      await tick();
      state.lastError = null;
      backoff = POLL_SECONDS;
    } catch (e) {
      state.lastError = String(e).slice(0, 300);
      log("error", { error: state.lastError, retryInSeconds: backoff });
      backoff = Math.min(backoff * 2, 300);
    }
    if (ONCE) break;
    await sleep(backoff * 1000);
  }
}

/** Refuse to run with anything broader than a function-call key for `run_due` on the contract. */
async function assertKeyIsRestricted(): Promise<void> {
  const pk = keeper.getSigner()!.getPublicKey();
  const key = await provider.viewAccessKey({ accountId: KEEPER_ACCOUNT, publicKey: (await pk).toString() });
  const perm: any = key.permission;
  if (perm === "FullAccess") throw new Error("Refusing to run with a full-access key. Create a function-call key with scripts/keeper-key.ts");
  const fc = perm.FunctionCall;
  if (fc.receiver_id !== CONTRACT || !(fc.method_names ?? []).every((m: string) => m === "run_due") || (fc.method_names ?? []).length === 0) {
    throw new Error(`Keeper key must be limited to ${CONTRACT}:run_due, got ${JSON.stringify(fc)}`);
  }
  log("key verified", { receiver: fc.receiver_id, methods: fc.method_names, allowance_near: fc.allowance ? Number(BigInt(fc.allowance) / 10n ** 18n) / 1e6 : "unlimited" });
}

function startStatusServer(port: number): void {
  http
    .createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.setHeader("access-control-allow-origin", "*");
      res.end(JSON.stringify({ ok: true, contract: CONTRACT, account: KEEPER_ACCOUNT, ...state }, null, 2));
    })
    .listen(port, () => log("status endpoint", { url: `http://localhost:${port}/` }));
}

function decode<T>(res: any): T {
  const v = res.status?.SuccessValue;
  if (v === undefined) throw new Error(`run_due failed: ${JSON.stringify(res.status)}`);
  return JSON.parse(Buffer.from(v, "base64").toString() || "null") as T;
}

function record(entry: Record<string, unknown>): void {
  state.recent.unshift(entry);
  state.recent = state.recent.slice(0, 50);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    /* logging must never stop the keeper */
  }
}

function log(event: string, detail?: unknown): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...(detail && typeof detail === "object" ? detail : { detail }) }));
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} (see keeper/.env or scripts/keeper-key.ts)`);
  return v;
}

function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((e) => {
  log("fatal", { error: String(e) });
  process.exit(1);
});
