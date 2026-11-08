// Give the keeper account a function-call access key that can ONLY call `run_due` on the contract.
// The key is written to keeper/.env (gitignored). The keeper service uses this key and nothing else.
import fs from "node:fs";
import { KeyPair } from "near-api-js";
import { account, cfg, log, NEAR, provider } from "./lib/near.ts";

const keeper = account(cfg.keeper);
const kp = KeyPair.fromRandom("ed25519");
await keeper.addFunctionCallAccessKey({
  publicKey: kp.getPublicKey(),
  contractId: cfg.contract,
  methodNames: ["run_due"],
  allowance: NEAR(process.env.SO_KEEPER_ALLOWANCE ?? 2), // gas allowance; immutable once set, add a new key when spent
});
const env = [
  `NEAR_NETWORK=${process.env.NEAR_NETWORK ?? "testnet"}`,
  `SO_CONTRACT=${cfg.contract}`,
  `KEEPER_ACCOUNT=${cfg.keeper}`,
  `KEEPER_KEY=${kp.toString()}`,
  `POLL_SECONDS=15`,
  "",
].join("\n");
fs.writeFileSync(new URL("../keeper/.env", import.meta.url), env, { mode: 0o600 });
const keys = await provider.viewAccessKeyList({ accountId: cfg.keeper });
log("keeper keys", keys.keys.map((k: any) => ({ key: k.public_key.slice(0, 20) + "…", permission: k.access_key.permission === "FullAccess" ? "FullAccess" : k.access_key.permission.FunctionCall })));
log("wrote keeper/.env with the function-call key");
