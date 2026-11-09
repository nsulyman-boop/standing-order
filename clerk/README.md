# Private payroll clerk (NEAR AI Cloud)

The clerk is the one place in Standing Order where a language model earns its keep: reading the
documents humans actually have (invoices, agreements, a CSV from the community lead) and turning
them into a payroll proposal the council can vote on, plus a plain-English brief of what a pending
proposal really does. Everything else in Standing Order is deterministic on purpose.

Why private: salary data is the most sensitive thing a treasury holds. The clerk sends documents only
to a **NEAR-operated model inside a hardware enclave (TEE)** on [NEAR AI Cloud](https://cloud.near.ai),
and keeps a receipt that lets anyone re-verify the run.

## What a receipt proves

For every model call (`clerk/src/nearai.ts`):

1. **Preflight attestation with a fresh nonce.** `GET /v1/attestation/report?model=…&provider=near&nonce=…`
   returns the gateway and model-TEE signing addresses with Intel TDX and NVIDIA evidence; the nonce must be
   echoed back (replay protection).
2. **Exact bytes.** The request body is hashed before sending; the response bytes are hashed before parsing.
3. **Signature.** `GET /v1/signature/<chat id>` returns `text = <model>:<sha256(request)>:<sha256(response)>`
   signed by the model TEE (`signature_kind = provider_tee`). The clerk recovers the EIP-191 signer and requires
   it to equal exactly one attested model address from step 1.
4. The receipt (`model`, `nonce`, hashes, signature, recovered signer, per-check results) is stored next to the review.

Limits, stated plainly: the clerk verifies the signer against the attestation report's addresses and the nonce
echo; it does not yet replay the TDX event log or call NVIDIA's attestation service (the official
[verification example](https://github.com/near-examples/nearai-cloud-verification-example) shows that extra step).
A verified receipt proves *which model, inside an attested enclave, produced this exact answer to this exact
input*; it does not prove the answer is correct. That is why deterministic checks run regardless.

## Deterministic checks (always run, never hidden by the model)

`clerk/src/checks.ts` and on-chain lookups: invalid or non-existent accounts, missing token storage
registration (the transfer would fail), duplicates, decimals slips (USDC has 6 decimals; 100 USDC is
`100000000` base units), dust, cap below the run total, loose caps, new recipients, raises above 50%,
cuts below 50%, removed recipients, unknown accounts, runway in runs, leftover funds.

On the demo DAO the first draft was **blocked** because the new joiner's account did not exist yet on
testnet (the payout would have failed); after the account was created the same documents produced
proposal #23, approved as plan #4.

## Use

```bash
export NEARAI_CLOUD_API_KEY=sk-…        # cloud.near.ai → API Keys (hackathon builders get $10 via nearbuilders.org/join)
npm run clerk -- review 7               # brief + checks for a pending Sputnik proposal that touches Standing Order
npm run clerk -- draft clerk/samples --plan 3            # read invoices, compare with plan #3, propose an update
npm run clerk -- draft clerk/samples --file --vote \
   --title "November payroll" --interval 2592000 --runs 3   # file the drafted proposal on the DAO (and, on the demo DAO, approve it)
```

Each run writes `clerk/reviews/<proposal>.json` and refreshes `clerk/reviews/index.json`; the dashboard
publishes them (`web/public/reviews/`) and shows a **Clerk · ask · TEE-verified** badge on the request.
Model: `Qwen/Qwen3.8-27B` (NEAR-hosted, attested) with `z-ai/glm-5.3-flash` as fallback; reasoning is
disabled and output capped at 1,200 tokens because hackathon-tier accounts reserve credit per request.

Sample documents in `clerk/samples/` are fictional.
