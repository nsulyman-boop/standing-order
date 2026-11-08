# Testnet deployment (live)

| Role | Account |
|---|---|
| Standing Order contract | `standing-order.testnet` |
| Sputnik DAO (treasury) | `payroll-demo.sputnik-v2.testnet` (factory `sputnik-v2.testnet`, council of 2, threshold 1/2 → both must vote) |
| Council | `council1.standing-order.testnet`, `council2.standing-order.testnet` |
| Recipients | `dev1.standing-order.testnet`, `dev2.standing-order.testnet`, `design.standing-order.testnet` |
| Keeper | `keeper.standing-order.testnet` (function-call key limited to `run_due`, see Phase 4) |
| Token | `usdc.fakes.testnet` (USDC.e test token with public `mint`) |

## First live loop (2026-11-08)

| Step | Transaction |
|---|---|
| Proposal #0: fund plan with 1,200 USDC.e via `ft_transfer_call` → `create_plan` | https://testnet.nearblocks.io/txns/5iHCNcWkzetkziAPKG3ymJq8kn8g5Kb15mcnFPJ6LLGZ |
| council2 approves → proposal executes, Plan #1 created | https://testnet.nearblocks.io/txns/8ym6jz9FzATsRYJ2bdx8emjQLKjHJPVNWVupeshhfdvU |
| Keeper `run_due(1)` → run 0 pays 100 / 80 / 60 USDC.e | https://testnet.nearblocks.io/txns/8h41ZhNLjaUz5XPMV2sW26gWjcrHgbCavAAL9teJyPgm |
| Proposal #1 `pause_plan` approved | https://testnet.nearblocks.io/txns/9CjsSsMf5Nj5DzTA6rh4626s8u55YTxaex8JxkFjTfdQ |
| Keeper `run_due(1)` → `Paused`, nothing moves | https://testnet.nearblocks.io/txns/9rZnKYxUGFQRRC8dNaN8p4znv8tHDa2hWYG5UkMEHomY |
| Proposal #2 `resume_plan` approved | https://testnet.nearblocks.io/txns/CgF3eURnih2sYaxxZGDCStuWXbFEhWFe1fXpkRthT5VX |
| Keeper `run_due(1)` → run 1 pays again | https://testnet.nearblocks.io/txns/5R6ovaZTDdnEnBQe6VK9mcDrpW4pJE3FGfVW8axFJbcT |

## Gotchas learned

- A Sputnik `Transfer` proposal with `msg` attaches only 10 TGas to `ft_transfer_call`
  (`GAS_FOR_FT_TRANSFER` in `sputnikdao2/src/types.rs`). Standard NEP-141 contracts require more than
  30 TGas for `ft_transfer_call`, so that path fails. Fund plans with a `FunctionCall` proposal on the
  token contract (`ft_transfer_call`, 1 yoctoNEAR, 100 TGas) instead. This is also the shape Trezu's
  custom proposal templates produce.
- `near-sdk` 5.30 only emits host calls such as `env::panic_str` when built with `--cfg near`
  (see `contract/.cargo/config.toml`); without it every panic is an opaque `unreachable` trap.
- `near_sdk::store` collections write lazily: flush before measuring `storage_usage`.
- The keeper must hold enough NEAR to prepay 300 TGas per call (about 0.03 NEAR actually burnt, the rest refunded).
- Node 22's `fetch` ignores `HTTPS_PROXY`; set `NODE_USE_ENV_PROXY=1` behind a proxy.

## Trezu template proof (2026-11-08)

| Step | Transaction |
|---|---|
| Proposal #5 filed with the `FunctionCall` kind + description compiled by Trezu's own template engine from `trezu-templates/testnet/so-create-plan.json` | https://testnet.nearblocks.io/txns/2x8osuRn1DUyag1pkBqCkeh4EjPkiCLWM6RGq3qSDGpn |
| council2 approves → Plan #2 "Design retainer (filed from a Trezu template)" created with 300 USDC.e | https://testnet.nearblocks.io/txns/86WDFZKDHqov25uZvJnebcXHyiVN1TSdV96fPGxJ9JmE |

## Later additions (2026-11-08)

- Proposal #6: top up plan #1 with 1,200 USDC.e (approved). Proposal #7: new plan #3 "Core team retainer, every 10 minutes",
  24 runs × 270 USDC.e (approved): https://testnet.nearblocks.io/txns/CUg1stp4yNrPHunuskDZWkbwAZA6f9jkwqjG2gQn2QFU
- `dev1.standing-order.testnet` registered a destination (USDC on Base). On testnet the keeper logs
  `route unavailable, paying on NEAR` because 1Click rejects the testnet token (`tokenIn is not valid`), and pays on NEAR.
- Contract redeployed with `--migrate` (v0.1 → routes); plan history preserved.
