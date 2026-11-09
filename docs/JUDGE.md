# Judge checks (`npm run judge`) and ledger export (`npm run ledger`)

Both commands need only `npm ci` on a fresh clone: no NEAR account, no keys, no funds, no API key.
They only make view calls against the public testnet RPC (`https://test.rpc.fastnear.com`,
override with `NEAR_RPC_URL`) and read files already in the repository. Behind an HTTP proxy set
`NODE_USE_ENV_PROXY=1`.

## `npm run judge` (`scripts/judge.ts`)

Prints a numbered checklist, one line per check with `[ok]`, `[FAIL]` or `[skip]` and the
evidence under it, then `judge: N checks, N ok`. The exit code is non-zero if any check fails.
The same job runs in CI (`.github/workflows/test.yml`, job `judge`).

| # | Check | How | Needs |
|---|---|---|---|
| 1 | Contract reachable | `get_plans` on `standing-order.testnet`; prints plan count, active count and plan owners (the Sputnik DAO). | RPC |
| 2 | Payroll is actually running | `get_payouts` over the last 10 records of every plan, picks the newest; prints recipient, token-formatted amount (`ft_metadata` decimals), status, age. Fails if the newest payout is older than 180 minutes or `Failed`. Live plans run every 10–60 minutes. | RPC |
| 3 | Keeper key is restricted | `view_access_key_list` for every keeper account (`KEEPER_ACCOUNTS`, default `keeper.standing-order.testnet,keeper2.standing-order.testnet`). Passes only if every key is a `FunctionCall` key with `receiver_id = standing-order.testnet` and `method_names = ["run_due"]`; prints each key's permission and remaining allowance. | RPC |
| 4 | 1Click quote signature | Offline. Loads `contract/tests/fixtures/quote_live.json` (a real non-dry quote from the 1Click API), rebuilds the signed message exactly as `contract/src/routes.rs::signed_message` and the official SDK's `quoteHash` do (`base58(sha256(stable_json({...signedRequestFields, ...signedQuoteFields, timestamp})))`), and verifies the ed25519 signature against the 1Click manager key `reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc` with Node's built-in `crypto`. Also confirms that changing the deposit address breaks the signature. | nothing |
| 5 | Clerk receipts | Offline. For every `clerk/reviews/proposal-*.json` and `draft-*.json`: signed text must equal `<model>:<request_hash>:<response_hash>`, the EIP-191 signer recovered with `ethers.verifyMessage` must equal the stored `recovered_signer` and appear exactly once in the stored attestation's `model_signing_addresses`, and the attestation nonce must have been echoed. This is the `provider_tee` branch of `clerk/src/nearai.ts`, replayed from the stored receipt. Prints model, chat id and signer. | nothing |
| 6 | NEAR AI attestation (optional) | Fetches `https://cloud-api.near.ai/v1/attestation/report?model=<model>` with a fresh nonce and no API key; prints the attested signing addresses, whether the nonce was echoed and whether Intel/NVIDIA quotes are present, and whether the receipts' signer is still attested. Skipped with a note if the endpoint is unreachable or starts requiring a key. | network |

What the checks do not prove: 4 and 5 verify signatures over data stored in the repository, so
they show the verification logic is sound and the stored artefacts are genuine, not that the
contract on testnet runs the same code as `contract/src` (the sandbox tests in `./scripts/test.sh`
cover the contract itself). Check 2 is a liveness probe and depends on the hosted keeper being up.

## `npm run ledger` (`scripts/ledger.ts`)

Exports every `PayoutRecord` on the contract (all plans, paged through `get_payouts`) joined with
its `RouteRecord` (`get_route`) when the payout went cross-chain.

```bash
npm run ledger                          # CSV on stdout
npm run ledger -- --out payouts.csv     # CSV to a file
npm run ledger -- --json                # JSON array
```

Columns: `date` (ISO 8601 from the block timestamp), `plan_id`, `plan_title`, `seq`, `run_index`,
`recipient`, `amount` (decimal, token units), `token_symbol`, `token_contract` (`near` for native),
`status` (`Pending` / `Sent` / `Failed`; a failed transfer is re-credited to the plan),
`route` (`near` when paid directly, otherwise `<destination asset> → <destination address>`),
`route_destination_asset`, `route_destination_address`, `route_deposit_address` (the 1Click deposit
account the contract paid), `route_amount_out`, `route_correlation_id`, `source_dao` (plan owner),
`amount_base_units`, `block_height`. Rows are sorted by date, then plan and sequence.
