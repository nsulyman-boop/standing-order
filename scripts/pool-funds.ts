// One-off helper: move testnet NEAR from faucet-funded accounts into the master account.
import { account, cfg, log, NEAR } from "./lib/near.ts";

const sources = (process.argv[2] ?? "so-funder-1.testnet,so-funder-2.testnet").split(",");
for (const f of sources) {
  try {
    const a = account(f);
    const bal = await a.getBalance();
    const send = bal - NEAR(0.05);
    if (send <= 0n) continue;
    await a.transfer({ receiverId: cfg.master, amount: send });
    log("moved", `${(Number(send) / 1e24).toFixed(3)} NEAR from ${f}`);
  } catch (e) {
    console.error("ERR", f, String(e).slice(0, 600));
  }
}
log("master balance", (Number(await account(cfg.master).getBalance()) / 1e24).toFixed(3));
