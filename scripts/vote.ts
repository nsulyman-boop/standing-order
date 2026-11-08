// Every council member approves the proposal; the vote that reaches the threshold executes it.
// Usage: npm run vote -- <proposal id> [VoteApprove|VoteReject]
import { cfg } from "./lib/near.ts";
import { vote, proposal } from "./lib/dao.ts";

const id = Number(process.argv[2]);
const action = (process.argv[3] as any) ?? "VoteApprove";
if (Number.isNaN(id)) {
  console.error("usage: vote.ts <proposal id> [VoteApprove|VoteReject]");
  process.exit(1);
}
let p = await proposal(id);
for (const member of cfg.council) {
  if (p.status !== "InProgress") break;
  if (p.votes?.[member]) continue;
  p = await vote(member, id, action);
}
console.log(`\nProposal #${id}: ${p.status}`);
if (p.status !== "Approved" && p.status !== "InProgress") process.exitCode = 1;
