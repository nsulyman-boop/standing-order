import { JsonRpcProvider } from "near-api-js";
import { CONTRACT, DAO, RPC_URL, TOKEN } from "./config";

export const provider = new JsonRpcProvider({ url: RPC_URL });

export async function view<T = any>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as unknown as T;
}

export type Asset = "Near" | { Ft: { contract: string } };
export interface Recipient {
  account_id: string;
  amount: string;
}
export interface Plan {
  id: number;
  owner: string;
  title: string;
  asset: Asset;
  recipients: Recipient[];
  interval_seconds: number;
  next_run_at: number;
  end_at: number | null;
  cap_per_run: string;
  balance: string;
  status: "Active" | "Paused" | "Cancelled";
  runs_completed: number;
  run_cursor: number | null;
  payout_count: number;
  created_at: number;
  updated_at: number;
}
export interface Payout {
  plan_id: number;
  seq: number;
  run_index: number;
  recipient: string;
  amount: string;
  status: "Pending" | "Sent" | "Failed";
  timestamp: number;
  block_height: number;
}
export interface RouteRecord {
  deposit_address: string;
  destination_asset: string;
  destination_address: string;
  amount_out: string;
  min_amount_out: string;
  deadline: number;
  correlation_id: string;
}
export interface Destination {
  asset_id: string;
  address: string;
  updated_at: number;
}
export interface TokenMeta {
  symbol: string;
  decimals: number;
  icon?: string | null;
  name: string;
}
export interface Proposal {
  id: number;
  proposer: string;
  description: string;
  kind: any;
  status: string;
  vote_counts: Record<string, number[]>;
  votes: Record<string, string>;
  submission_time: string;
}

export const getConfig = () => view(CONTRACT, "get_config");
export const getPlans = () => view<Plan[]>(CONTRACT, "get_plans", { from_index: 0, limit: 100 });
export const getPlan = (plan_id: number) => view<Plan | null>(CONTRACT, "get_plan", { plan_id });
export const getPayouts = (plan_id: number, from_seq: number, limit: number) => view<Payout[]>(CONTRACT, "get_payouts", { plan_id, from_seq, limit });
export const getRoute = (plan_id: number, seq: number) => view<RouteRecord | null>(CONTRACT, "get_route", { plan_id, seq });
export const getDestination = (account_id: string) => view<Destination | null>(CONTRACT, "get_destination", { account_id });
export const getPlanDestinations = (plan_id: number) => view<Array<[string, Destination]>>(CONTRACT, "get_plan_destinations", { plan_id });
export const getNow = () => view<number>(CONTRACT, "now_seconds");
export const getTokenMeta = () => view<TokenMeta>(TOKEN, "ft_metadata");
export const getTokenBalance = (account_id: string) => view<string>(TOKEN, "ft_balance_of", { account_id });

export async function getDaoProposals(limit = 30): Promise<Proposal[]> {
  const last = await view<number>(DAO, "get_last_proposal_id");
  const from = Math.max(0, last - limit);
  const proposals = await view<Proposal[]>(DAO, "get_proposals", { from_index: from, limit });
  return proposals.reverse();
}

export async function getDaoPolicy() {
  return view(DAO, "get_policy");
}

/** Does this Sputnik proposal touch Standing Order (directly or via a token transfer into it)? */
export function proposalTouchesStandingOrder(p: Proposal): { kind: string; method?: string; args?: any } | null {
  const fc = p.kind?.FunctionCall;
  if (!fc) return null;
  const action = fc.actions?.[0];
  if (!action) return null;
  let args: any = undefined;
  try {
    args = JSON.parse(atob(action.args));
  } catch {
    /* non-JSON args */
  }
  if (fc.receiver_id === CONTRACT) return { kind: "manage", method: action.method_name, args };
  if (action.method_name === "ft_transfer_call" && args?.receiver_id === CONTRACT) {
    let msg: any = undefined;
    try {
      msg = JSON.parse(args.msg);
    } catch {
      /* ignore */
    }
    return { kind: "fund", method: msg?.action ?? "ft_transfer_call", args: { ...args, msg } };
  }
  return null;
}
