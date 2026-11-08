// A recipient registers where cross-chain payouts should land.
// Usage: tsx scripts/register-destination.ts <account> <intents asset id> <address>
// Example: tsx scripts/register-destination.ts dev1.standing-order.testnet nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
import { account, cfg, log, NEAR, TGAS, view } from "./lib/near.ts";

const [who, asset_id, address] = process.argv.slice(2);
if (!who || !asset_id || !address) {
  console.error("usage: register-destination.ts <account> <asset_id> <address>");
  process.exit(1);
}
await account(who).callFunction({ contractId: cfg.contract, methodName: "register_destination", args: { asset_id, address }, gas: TGAS(30), deposit: NEAR(0.01) });
log("destination registered", await view(cfg.contract, "get_destination", { account_id: who }));
