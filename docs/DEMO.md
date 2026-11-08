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
> Live on testnet, Trezu templates included.
> Repo: <link> · Demo DAO: payroll-demo.sputnik-v2.testnet
> @NEARProtocol #NEARHackathon @NearBuilders @NearLegion
>
> Which DAO should run payroll on this first?

Attach `docs/demo.mp4` (or the screenshots in `docs/screenshots/`).
