# Trezu integration: custom proposal templates

[Trezu](https://trezu.org) (NEAR DevHub's treasury app for Sputnik DAOs) lets a DAO turn any
contract call into a reusable form through **custom proposal templates**: a JSON manifest that
members fill in, which Trezu compiles into a Sputnik `FunctionCall` proposal. Standing Order plugs
into Trezu through exactly that mechanism, with **no changes to Trezu**.

| Template | What the form files | Who approves |
|---|---|---|
| `so-create-plan` | `ft_transfer_call` on the payroll token → Standing Order `create_plan` (funds + schedule in one proposal) | normal DAO vote |
| `so-top-up` | `ft_transfer_call` → `fund_plan` | normal DAO vote |
| `so-pause` / `so-resume` | `pause_plan` / `resume_plan` (optionally skipping missed periods) | normal DAO vote |
| `so-update-recipients` | `update_plan` with new recipients and cap | normal DAO vote |
| `so-cancel` | `cancel_plan` → remaining balance returns to the treasury | normal DAO vote |

Manifests are generated per network (token contract and Standing Order contract differ):

```bash
npx tsx trezu-templates/generate.ts testnet     # → trezu-templates/testnet/*.json
SO_CONTRACT=standing-order.near npx tsx trezu-templates/generate.ts mainnet
```

## Verified with Trezu's own engine

`check.ts` runs **Trezu's actual manifest validator and proposal builder** (fetched from the
NEAR-DevHub/trezu repository by `fetch-trezu.sh`, not vendored) over every manifest, then, with
`--submit`, files the compiled "start recurring payroll" proposal on the demo DAO and approves it:

```bash
./trezu-templates/fetch-trezu.sh
npx tsx --tsconfig trezu-templates/tsconfig.json trezu-templates/check.ts testnet            # validate + compile
npx tsx --tsconfig trezu-templates/tsconfig.json trezu-templates/check.ts testnet --submit   # file + approve on testnet
```

Expected: seven `✓` lines, then `plan created from Trezu template` with the new plan id. The
description Trezu generates carries the `[trezu-tmpl:<id>]` tag, so the request is traceable to
the template in Trezu's UI.

## Installing in Trezu

1. Open the treasury in Trezu → **Custom** → enable Custom Requests (needs the DAO's `ChangePolicy` permission).
2. **New template → Code tab**, paste a manifest from `trezu-templates/<network>/`, **Save**.
3. Members now see "Standing Order: start recurring payroll" as a request form. Filling it files the
   proposal; once the council approves, the plan is live and the keeper pays it on schedule.

Notes
- Amount fields are base units (USDC has 6 decimals). Trezu keeps them as strings, so u128 values are safe.
- `plan_id` fields use Trezu's `number` type so the contract receives a JSON number for its `u64` argument.
- The plan title is embedded in a JSON string; avoid double quotes in it.
- Trezu's hosted backend indexes mainnet treasuries. On testnet the proof is `check.ts --submit`,
  which files the identical proposal Trezu would file.
