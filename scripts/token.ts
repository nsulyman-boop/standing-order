// Prepare the demo token: register storage for everyone involved and give the DAO a balance.
// Uses the public-mint test token on testnet by default (SO_TOKEN); see README for mainnet USDC.
import { account, cfg, log, NEAR, TGAS, view } from "./lib/near.ts";

const master = account(cfg.master);
const everyone = [cfg.contract, cfg.dao, ...cfg.recipients, cfg.master];
for (const id of everyone) {
  const bal = await view<any>(cfg.token, "storage_balance_of", { account_id: id });
  if (bal) {
    log("registered", id);
    continue;
  }
  await master.callFunction({
    contractId: cfg.token,
    methodName: "storage_deposit",
    args: { account_id: id, registration_only: true },
    gas: TGAS(30),
    deposit: NEAR(0.00125),
  });
  log("registered storage", id);
}
const meta = await view<any>(cfg.token, "ft_metadata");
const units = 10n ** BigInt(meta.decimals);
const target = BigInt(process.env.SO_DAO_TOKENS ?? 5000) * units;
const current = BigInt(await view<string>(cfg.token, "ft_balance_of", { account_id: cfg.dao }));
if (current < target) {
  await master.callFunction({
    contractId: cfg.token,
    methodName: "mint",
    args: { account_id: cfg.dao, amount: (target - current).toString() },
    gas: TGAS(30),
  });
  log("minted", `${Number(target - current) / Number(units)} ${meta.symbol} to ${cfg.dao}`);
}
log("dao token balance", `${Number(await view<string>(cfg.token, "ft_balance_of", { account_id: cfg.dao })) / Number(units)} ${meta.symbol}`);
