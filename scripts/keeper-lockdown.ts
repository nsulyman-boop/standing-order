// One-time hardening of the keeper account: fund gas, add a run_due-only key without an allowance cap, then
// delete every FullAccess key so the account can never do anything but trigger due payroll runs.
// Usage: npm run keeper:lockdown   (writes keeper/.env and the key for a CI secret to $KEEPER_KEY_OUT or keeper/.keeper-key.txt)
import fs from "node:fs";
import { KeyPair } from "near-api-js";
import { account, cfg, log, NEAR, provider } from "./lib/near.ts";
const keeper = account(cfg.keeper);           // currently signs with the FullAccess key on disk
const master = account(cfg.master);
// 1. fund gas for the judging window (~0.003 NEAR per run, ~260 runs/day)
await master.transfer({ receiverId: cfg.keeper, amount: NEAR(process.env.SO_KEEPER_GAS_NEAR ?? 9) });
// 2. new run_due-only key with a large allowance (the method restriction is the security boundary; gas is bounded by the account balance)
const kp = KeyPair.fromRandom("ed25519");
// near-api-js defaults a missing allowance to 0.25 NEAR, so set it explicitly; it only caps gas for this one method.
await keeper.addFunctionCallAccessKey({ publicKey: kp.getPublicKey(), contractId: cfg.contract, methodNames: ["run_due"], allowance: NEAR(process.env.SO_KEEPER_ALLOWANCE ?? 100) });
const env = [`NEAR_NETWORK=testnet`, `SO_CONTRACT=${cfg.contract}`, `KEEPER_ACCOUNT=${cfg.keeper}`, `KEEPER_KEY=${kp.toString()}`, `POLL_SECONDS=15`, ""].join("\n");
fs.writeFileSync(new URL("../keeper/.env", import.meta.url), env, { mode: 0o600 });
fs.writeFileSync(process.env.KEEPER_KEY_OUT ?? new URL("../keeper/.keeper-key.txt", import.meta.url), kp.toString(), { mode: 0o600 });
// 3. remove the FullAccess key: from now on the account can only ever call run_due
const before = await provider.viewAccessKeyList({ accountId: cfg.keeper });
const full = before.keys.filter((k: any) => k.access_key.permission === "FullAccess");
for (const k of full) await keeper.deleteKey(k.public_key);
const after = await provider.viewAccessKeyList({ accountId: cfg.keeper });
log("keeper keys now", after.keys.map((k: any) => ({ key: k.public_key.slice(0, 24) + "…", perm: k.access_key.permission === "FullAccess" ? "FullAccess" : { receiver: k.access_key.permission.FunctionCall.receiver_id, methods: k.access_key.permission.FunctionCall.method_names, allowance: k.access_key.permission.FunctionCall.allowance } })));
const acct = await provider.viewAccount({ accountId: cfg.keeper });
log("keeper balance NEAR", Number(acct.amount) / 1e24);
