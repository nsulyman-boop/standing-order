// Create the demo sub-accounts (council members, recipients, keeper) under the master account.
import { KeyPair } from "near-api-js";
import { account, accountExists, cfg, log, NEAR, saveKey } from "./lib/near.ts";

const master = account(cfg.master);
const wanted: Array<[string, number]> = [
  ...cfg.council.map((c) => [c, 0.5] as [string, number]),
  ...cfg.recipients.map((r) => [r, 0.1] as [string, number]),
  [cfg.keeper, 0.3],
];

for (const [id, near] of wanted) {
  if (await accountExists(id)) {
    log("exists", id);
    continue;
  }
  const kp = KeyPair.fromRandom("ed25519");
  await master.createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: NEAR(near) });
  saveKey(id, kp);
  log("created", `${id} with ${near} NEAR`);
}
log("done");
