// Create the demo Sputnik DAO through the factory with the council accounts as members.
import { account, accountExists, b64, cfg, log, NEAR, TGAS, view } from "./lib/near.ts";

if (await accountExists(cfg.dao)) {
  log("dao exists", cfg.dao);
} else {
  const master = account(cfg.master);
  const args = {
    config: { name: cfg.daoName, purpose: "Standing Order demo treasury: pays contributors on a schedule", metadata: "" },
    policy: cfg.council,
  };
  log("creating dao", { dao: cfg.dao, council: cfg.council });
  await master.callFunction({
    contractId: cfg.factory,
    methodName: "create",
    args: { name: cfg.daoName, args: b64(args) },
    gas: TGAS(150),
    deposit: NEAR(process.env.SO_DAO_DEPOSIT ?? 6),
  });
}
const policy = await view<any>(cfg.dao, "get_policy");
log("policy", {
  roles: policy.roles.map((r: any) => ({ name: r.name, kind: r.kind, permissions: r.permissions })),
  proposal_bond: policy.proposal_bond,
  default_vote_policy: policy.default_vote_policy,
});
