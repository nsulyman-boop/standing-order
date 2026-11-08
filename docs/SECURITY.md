# Threat model

## Actors
- **Treasury (plan owner)**: a Sputnik DAO. Can create/fund (via vote), pause, resume, update, cancel, sweep.
- **Keeper**: any account; the reference keeper holds a function-call key limited to `run_due`.
- **Recipients**: NEAR accounts; may register a cross-chain destination.
- **1Click (NEAR Intents)**: signs quotes and executes swaps off-chain.
- **Contract owner**: can toggle storage sponsorship, limits, and rotate the 1Click public key. Cannot touch plan funds.

## What each actor can and cannot do

| Actor | Can | Cannot |
|---|---|---|
| Keeper (compromised key) | Trigger a due run up to one polling interval early; spend its own gas allowance | Change recipients, amounts, cadence; move funds to itself; pay a non-due plan; pay partially; route a payout without a 1Click signature over the recipient's registered address |
| Treasury | Everything above through votes; sweep remaining balance any time (not mid-run) | Claw back a payout already sent |
| Recipient | Register/clear their own destination | Change anyone else's destination or amounts |
| Contract owner | Rotate the 1Click key, toggle sponsored storage | Access plan balances |
| 1Click | Execute or refund the swap it quoted | Receive funds for an unquoted address: the contract only pays `depositAddress` from a signed quote whose `recipient`/`destinationAsset` equal the recipient's own registration |

## Cross-chain route verification (contract/src/routes.rs)
1. Rebuild 1Click's signed message exactly as the SDK does: the documented subset of request and quote fields,
   quote fields overriding request fields, keys sorted, compact JSON, `base58(sha256(json))`.
2. `env::ed25519_verify` against the configured 1Click manager key (default from the official SDK, owner-rotatable).
3. Bindings: non-dry quote; `originAsset == nep141:<plan token>`; `amount == recipient amount`; `destinationAsset` and
   `recipient` equal the recipient's registration; `refundTo == recipient account`; `deadline > now + 60 s`.
4. On any mismatch the whole `run_due` call panics; nothing is paid.

Residual risk: 1Click could fail to execute a signed quote. Then the deposit is refunded to the recipient's
NEAR account by 1Click's refund flow (`refundTo`), and the plan's accounting is unaffected. The keeper records
1Click status transitions for every routed payout.

## Operational notes
- Native transfers to non-existent accounts and token transfers to unregistered accounts fail safely: the
  callback marks the payout `Failed` and re-credits the plan balance; the schedule still advances.
- A plan that cannot afford a full run is reported by `get_underfunded_plans` and is not "due", so keepers do
  not burn gas on it.
- Storage: plans created through `ft_transfer_call` draw on the sender's storage credits, or on sponsorship
  when enabled (demo default). Disable sponsorship in production (`set_config`).
- `resume_plan` defaults to back pay (missed periods are paid one per `run_due` call); `skip_missed: true`
  forgets them. Both are explicit DAO decisions.
- Keeper key allowance is immutable once set; add a new key when it is spent.
