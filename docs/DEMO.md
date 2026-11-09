# Demo assets

## 60-second video storyboard (record from the dashboard + terminal)

| t | Screen | Voice / caption |
|---|---|---|
| 0–8 s | Dashboard hero + stats | "Your DAO votes on payroll twelve times a year. Standing Order: vote once." |
| 8–22 s | Terminal: `npm run propose:plan` → `npm run vote -- N`; dashboard "Treasury requests" shows the proposal flip to Approved and a new plan card appear | "One Sputnik proposal funds the plan: recipients, cadence, cap." |
| 22–38 s | Dashboard plan card countdown hits 00:00 → keeper log line → payout history fills, recipient balances rise | "A keeper whose key can only call `run_due` triggers payday. No signatures, no partial runs." |
| 38–48 s | Terminal: pause proposal + vote → keeper returns `Paused` | "The council can pause in one vote." |
| 48–56 s | "Get paid on another chain" panel: destination = USDC on Base; sandbox test output `routed_payout_goes_to_verified_deposit_address ... ok` | "Recipients choose the chain. The contract verifies 1Click's signature before paying the route." |
| 56–60 s | Repo README | "Open source. Trezu templates included. Try it in two minutes." |

`web/e2e/record-demo.mjs` records a 75-second screen capture of the live dashboard (`docs/demo.webm`, converted to `docs/demo.mp4`).

## X post (draft, human posts it)

> Your DAO votes on payroll 12× a year. Standing Order: vote once.
>
> Built at NEAR HACKATHON: a Sputnik DAO funds a plan in one vote, a keeper with a run_due-only key pays every period, and recipients get USDC on Base/Arbitrum/Solana via NEAR Intents, with 1Click's quote signature verified on-chain.
>
> Live on testnet, Trezu templates included: https://nsulyman-boop.github.io/standing-order/
> Repo: https://github.com/nsulyman-boop/standing-order · Demo DAO: payroll-demo.sputnik-v2.testnet
> @NEARProtocol #NEARHackathon @NearBuilders @NearLegion
>
> Which DAO should run payroll on this first?

Attach `docs/demo.mp4` (or the screenshots in `docs/screenshots/`).

## Pre-submission feedback post (draft, post 2–3 days before the 2026-11-14 deadline)

Where: the hackathon's builder channel / NEAR Builders forum, and as a reply under the X post if it is already out.
Goal: concrete answers that can still change the README and the default plan parameters before submission.

> **Standing Order: recurring payroll for Sputnik DAOs, looking for three answers before I submit**
>
> One DAO vote funds a payroll plan; a keeper whose key can only call `run_due` pays every period; the council can
> pause, resume (with or without back pay), top up or sweep by vote. Recipients can register a destination on
> Base/Arbitrum/Ethereum/Solana and the contract verifies 1Click's quote signature on-chain before paying the route.
> Live on testnet: `payroll-demo.sputnik-v2.testnet`, repo https://github.com/nsulyman-boop/standing-order.
>
> Three questions, answers from anyone who has sat on a council or been paid by one are most useful:
>
> 1. **Funding horizon.** A plan is funded up front and the DAO can sweep at any time. Would your council approve
>    3 months of payroll in one vote? 6? 12? Or would you rather fund one month and let a top-up proposal recur?
>    (The answer sets the default `end_at` and the top-up template's suggested amount.)
> 2. **Payout chain and asset.** Which chain/asset do contributors actually want to receive: USDC on Base, USDC on
>    Arbitrum, native NEAR, something else? The first mainnet routed payout will target the most-requested one.
> 3. **README "Try it".** Open https://github.com/nsulyman-boop/standing-order#try-it-do-x-see-y and tell me the first
>    sentence that is unclear, or the first command that did not do what the "See:" line promised. Section A (local
>    tests) and B (watch testnet, no keys) take under five minutes.
>
> Replies here or as issues on the repo. Thanks.

Record what comes back in `docs/PLAN.md` (one line per answer) and fold the README fixes in before the submission.
