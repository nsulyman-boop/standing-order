import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProposal, verdict } from "../src/checks.ts";

const base = { decimals: 6, symbol: "USDC" };
const codes = (f: ReturnType<typeof checkProposal>) => f.map((x) => x.code).sort();

test("clean payroll passes with runway info only", () => {
  const f = checkProposal({ ...base, recipients: [{ account_id: "a.near", amount: "100000000" }, { account_id: "b.near", amount: "50000000" }], capPerRun: "150000000", fundAmount: "450000000" });
  assert.equal(verdict(f), "ok");
  assert.deepEqual(codes(f), ["runway"]);
});

test("decimals slip, duplicates and bad accounts block", () => {
  const f = checkProposal({ ...base, recipients: [{ account_id: "a.near", amount: "100000000000000" }, { account_id: "a.near", amount: "1" }, { account_id: "Bad Name", amount: "5" }] });
  assert.equal(verdict(f), "block");
  for (const c of ["units", "duplicate", "bad_account", "dust"]) assert.ok(codes(f).includes(c), c);
});

test("cap below total blocks; loose cap warns", () => {
  assert.equal(verdict(checkProposal({ ...base, recipients: [{ account_id: "a.near", amount: "100000000" }], capPerRun: "1" })), "block");
  assert.ok(codes(checkProposal({ ...base, recipients: [{ account_id: "a.near", amount: "100000000" }], capPerRun: "900000000" })).includes("cap_loose"));
});

test("changes versus the previous plan are explained", () => {
  const prev = [{ account_id: "a.near", amount: "100000000" }, { account_id: "gone.near", amount: "10000000" }];
  const f = checkProposal({ ...base, recipients: [{ account_id: "a.near", amount: "200000000" }, { account_id: "new.near", amount: "10000000" }], previous: prev, knownAccounts: ["a.near", "gone.near"] });
  assert.deepEqual(codes(f), ["new_recipient", "raise", "removed", "unknown_account"]);
  assert.equal(verdict(f), "warn");
});

test("underfunded plan is a blocker", () => {
  assert.equal(verdict(checkProposal({ ...base, recipients: [{ account_id: "a.near", amount: "100000000" }], fundAmount: "1000" })), "block");
});
