// Sputnik DAO helpers: build proposals the way Trezu's custom templates do (FunctionCall with explicit gas).
import { account, b64, cfg, log, NEAR, TGAS, txLink, view } from "./near.ts";

export interface ActionCall {
  method_name: string;
  args: Record<string, unknown>;
  deposit?: string; // yoctoNEAR
  gas?: string; // gas units
}

/** Add a FunctionCall proposal and return its id. The proposer pays the bond (returned on approval). */
export async function proposeFunctionCall(proposer: string, receiverId: string, actions: ActionCall[], description: string): Promise<number> {
  const policy = await view<any>(cfg.dao, "get_policy");
  const bond = BigInt(policy.proposal_bond);
  const res = await account(proposer).callFunctionRaw({
    contractId: cfg.dao,
    methodName: "add_proposal",
    args: {
      proposal: {
        description,
        kind: {
          FunctionCall: {
            receiver_id: receiverId,
            actions: actions.map((a) => ({
              method_name: a.method_name,
              args: b64(a.args),
              deposit: a.deposit ?? "0",
              gas: a.gas ?? TGAS(100).toString(),
            })),
          },
        },
      },
    },
    gas: TGAS(100),
    deposit: bond,
  });
  const id = Number(Buffer.from((res.status as any).SuccessValue, "base64").toString());
  log("proposal added", { id, by: proposer, tx: txLink(res.transaction.hash) });
  return id;
}

export async function vote(voter: string, proposalId: number, action: "VoteApprove" | "VoteReject" | "VoteRemove" = "VoteApprove") {
  const res = await account(voter).callFunctionRaw({
    contractId: cfg.dao,
    methodName: "act_proposal",
    args: { id: proposalId, action },
    gas: TGAS(300),
  });
  const p = await view<any>(cfg.dao, "get_proposal", { id: proposalId });
  log(`${voter} voted ${action}`, { id: proposalId, status: p.status, tx: txLink(res.transaction.hash) });
  return p;
}

/** Read a proposal, retrying briefly: a view right after `add_proposal` can hit an RPC node that has not caught up. */
export async function proposal(id: number, retries = 8) {
  for (let i = 0; ; i++) {
    try {
      return await view<any>(cfg.dao, "get_proposal", { id });
    } catch (e) {
      if (i >= retries || !String(e).includes("ERR_NO_PROPOSAL")) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export { NEAR };
