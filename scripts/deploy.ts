// Deploy the Standing Order contract and initialise it (idempotent).
import fs from "node:fs";
import { account, cfg, log, provider, TGAS, view } from "./lib/near.ts";

const wasm = fs.readFileSync(new URL("../contract/target/wasm32-unknown-unknown/release/standing_order.wasm", import.meta.url));
const owner = account(cfg.contract);
log("deploying", `${wasm.length} bytes to ${cfg.contract}`);
await owner.deployContract(new Uint8Array(wasm));
try {
  const config = await view(cfg.contract, "get_config");
  log("already initialised", config);
} catch {
  await owner.callFunction({
    contractId: cfg.contract,
    methodName: "new",
    args: { owner_id: cfg.master, sponsor_storage: true, min_interval_seconds: Number(process.env.SO_MIN_INTERVAL ?? 60) },
    gas: TGAS(30),
  });
  log("initialised", await view(cfg.contract, "get_config"));
}
const state = await provider.viewAccount({ accountId: cfg.contract });
log("contract account", { storage_usage: state.storage_usage, balance_near: (Number(state.amount) / 1e24).toFixed(3) });
