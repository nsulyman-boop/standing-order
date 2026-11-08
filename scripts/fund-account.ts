// Send NEAR from the master account. Usage: tsx scripts/fund-account.ts <account> <near>
import { account, cfg, log, NEAR } from "./lib/near.ts";
const [to, amount] = process.argv.slice(2);
await account(cfg.master).transfer({ receiverId: to, amount: NEAR(amount) });
log("funded", `${to} +${amount} NEAR`);
