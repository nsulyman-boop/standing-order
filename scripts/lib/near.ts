// Shared helpers for the Standing Order scripts (near-api-js v7).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";

export const NETWORK = process.env.NEAR_NETWORK ?? "testnet";
export const RPC_URL =
  process.env.NEAR_RPC_URL ?? (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

export const provider = new JsonRpcProvider({ url: RPC_URL });

/** Demo topology. Override with env vars; see .env.example. */
export const cfg = {
  master: process.env.SO_MASTER ?? "standing-order.testnet",
  contract: process.env.SO_CONTRACT ?? "standing-order.testnet",
  factory: process.env.SO_FACTORY ?? "sputnik-v2.testnet",
  daoName: process.env.SO_DAO_NAME ?? "payroll-demo",
  get dao() {
    return process.env.SO_DAO ?? `${this.daoName}.${this.factory}`;
  },
  token: process.env.SO_TOKEN ?? "usdc.fakes.testnet",
  council: (process.env.SO_COUNCIL ?? "council1.standing-order.testnet,council2.standing-order.testnet").split(","),
  recipients: (process.env.SO_RECIPIENTS ?? "dev1.standing-order.testnet,dev2.standing-order.testnet,design.standing-order.testnet").split(","),
  get keeper() {
    return process.env.SO_KEEPER ?? `keeper.${this.master}`;
  },
};

const credDir = path.join(os.homedir(), ".near-credentials", NETWORK);

export function credentialPath(accountId: string): string {
  return path.join(credDir, `${accountId}.json`);
}

export function loadKey(accountId: string): KeyPairString {
  const envKey = process.env[`KEY_${accountId.replace(/[.-]/g, "_").toUpperCase()}`];
  if (envKey) return envKey as KeyPairString;
  const file = credentialPath(accountId);
  if (!fs.existsSync(file)) throw new Error(`No credentials for ${accountId} at ${file}`);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  return json.private_key as KeyPairString;
}

export function saveKey(accountId: string, keyPair: KeyPair): void {
  fs.mkdirSync(credDir, { recursive: true });
  const file = credentialPath(accountId);
  fs.writeFileSync(
    file,
    JSON.stringify({ account_id: accountId, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }, null, 2),
    { mode: 0o600 },
  );
}

export function account(accountId: string): Account {
  return new Account(accountId, provider, loadKey(accountId));
}

export async function view<T = unknown>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as unknown as T;
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

export const TGAS = (n: number) => BigInt(n) * 1_000_000_000_000n;
export const NEAR = (n: number | string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n; // n NEAR in yocto
export const yoctoToNear = (y: bigint | string) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4);

export function txLink(hash: string): string {
  return `${EXPLORER}/txns/${hash}`;
}

export function log(step: string, detail?: unknown): void {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${step}${detail !== undefined ? " " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`);
}

export const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64");
