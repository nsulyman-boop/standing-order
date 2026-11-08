//! Sandbox tests for native-NEAR plans: real transfers, callbacks, storage charging.
//! Build the wasm first: `cargo build --target wasm32-unknown-unknown --release` (see scripts/test.sh).

use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{network::Sandbox, Account, Contract, Worker};
use serde_json::{json, Value};

const WASM_PATH: &str = "target/wasm32-unknown-unknown/release/standing_order.wasm";
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

async fn setup() -> anyhow::Result<(Worker<Sandbox>, Contract, Account)> {
    let wasm = std::fs::read(WASM_PATH)
        .map_err(|e| anyhow::anyhow!("{WASM_PATH} not found ({e}); run scripts/test.sh or build the wasm first"))?;
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&wasm).await?;
    let owner = worker.dev_create_account().await?;
    let res = contract
        .call("new")
        .args_json(json!({"owner_id": owner.id(), "sponsor_storage": true, "min_interval_seconds": 1}))
        .transact()
        .await?;
    assert!(res.is_success(), "init failed: {:?}", res.failures());
    Ok((worker, contract, owner))
}

fn plan_input(recipients: &[(&Account, u128)], interval: u64) -> Value {
    json!({
        "title": "Core team payroll",
        "asset": "Near",
        "recipients": recipients.iter().map(|(a, amt)| json!({"account_id": a.id(), "amount": amt.to_string()})).collect::<Vec<_>>(),
        "interval_seconds": interval,
        "start_at": null,
        "end_at": null,
        "cap_per_run": null
    })
}

async fn balance(a: &Account) -> anyhow::Result<u128> {
    Ok(a.view_account().await?.balance.as_yoctonear())
}

async fn now(contract: &Contract) -> anyhow::Result<u64> {
    Ok(contract.view("now_seconds").await?.json()?)
}

async fn plan(contract: &Contract, id: u64) -> anyhow::Result<Value> {
    Ok(contract.view("get_plan").args_json(json!({"plan_id": id})).await?.json()?)
}

#[tokio::test]
async fn full_native_lifecycle() -> anyhow::Result<()> {
    let (worker, contract, _owner) = setup().await?;
    let dao = worker.dev_create_account().await?;
    let alice = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let keeper = worker.dev_create_account().await?;

    // 1. The DAO creates and funds a plan with 5 NEAR; storage is charged from the deposit.
    let res = dao
        .call(contract.id(), "create_plan")
        .args_json(json!({"plan": plan_input(&[(&alice, ONE_NEAR), (&bob, 2 * ONE_NEAR)], 3600)}))
        .deposit(NearToken::from_near(5))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(res.is_success(), "{:?}", res.failures());
    let created_logs = res.logs().iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let plan_id: u64 = res.json()?;
    let p = plan(&contract, plan_id).await?;
    let bal: u128 = p["balance"].as_str().unwrap().parse()?;
    assert!(bal < 5 * ONE_NEAR, "storage must be deducted from the deposit");
    assert!(bal > 5 * ONE_NEAR - ONE_NEAR / 10, "storage for a 2-recipient plan should cost < 0.1 NEAR, got {}", 5 * ONE_NEAR - bal);
    assert_eq!(p["status"], "Active");
    assert!(created_logs.iter().any(|l| l.contains("plan_created")));

    // 2. Anyone (the keeper) triggers the first run; recipients receive exactly their amounts.
    let alice_before = balance(&alice).await?;
    let bob_before = balance(&bob).await?;
    let res = keeper
        .call(contract.id(), "run_due")
        .args_json(json!({"plan_id": plan_id}))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    assert!(res.is_success(), "{:?}", res.failures());
    let run_logs = res.logs().iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let outcome: Value = res.json()?;
    assert_eq!(outcome["Sent"]["sent"], 2, "outcome: {outcome}");
    assert_eq!(outcome["Sent"]["completed"], true);
    assert_eq!(balance(&alice).await? - alice_before, ONE_NEAR);
    assert_eq!(balance(&bob).await? - bob_before, 2 * ONE_NEAR);

    // Callbacks ran inside the same transaction chain: records are Sent.
    let payouts: Vec<Value> = contract
        .view("get_payouts")
        .args_json(json!({"plan_id": plan_id, "from_seq": null, "limit": null}))
        .await?
        .json()?;
    assert_eq!(payouts.len(), 2);
    assert!(payouts.iter().all(|p| p["status"] == "Sent"), "{payouts:?}");
    assert_eq!(run_logs.iter().filter(|l| l.contains("payout_sent")).count(), 2, "{run_logs:?}");
    let p = plan(&contract, plan_id).await?;
    assert_eq!(p["runs_completed"], 1);
    let bal_after: u128 = p["balance"].as_str().unwrap().parse()?;
    assert_eq!(bal_after, bal - 3 * ONE_NEAR);

    // 3. Same period: NotDue, nothing moves.
    let res = keeper
        .call(contract.id(), "run_due")
        .args_json(json!({"plan_id": plan_id}))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    let outcome: Value = res.json()?;
    assert!(outcome.get("NotDue").is_some(), "outcome: {outcome}");
    assert_eq!(balance(&alice).await? - alice_before, ONE_NEAR);

    // 4. Pause from a non-owner fails; from the owner succeeds and blocks runs.
    let res = keeper.call(contract.id(), "pause_plan").args_json(json!({"plan_id": plan_id})).transact().await?;
    assert!(res.is_failure(), "non-owner must not pause");
    assert!(format!("{:?}", res.failures()).contains("Only the plan owner"));
    let res = dao.call(contract.id(), "pause_plan").args_json(json!({"plan_id": plan_id})).transact().await?;
    assert!(res.is_success(), "{:?}", res.failures());
    assert_eq!(plan(&contract, plan_id).await?["status"], "Paused");
    let due: Vec<u64> = contract.view("get_due_plans").args_json(json!({"limit": null})).await?.json()?;
    assert!(due.is_empty());

    // 5. Resume, then cancel: the remaining balance goes back to the DAO.
    dao.call(contract.id(), "resume_plan").args_json(json!({"plan_id": plan_id})).transact().await?.into_result()?;
    let dao_before = balance(&dao).await?;
    let res = dao
        .call(contract.id(), "cancel_plan")
        .args_json(json!({"plan_id": plan_id}))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(res.is_success(), "{:?}", res.failures());
    let dao_after = balance(&dao).await?;
    // Refund is bal_after minus gas spent by the DAO on this call (< 0.01 NEAR).
    assert!(dao_after > dao_before + bal_after - ONE_NEAR / 100, "refund not received: before {dao_before} after {dao_after} expected +{bal_after}");
    let p = plan(&contract, plan_id).await?;
    assert_eq!(p["status"], "Cancelled");
    assert_eq!(p["balance"], "0");
    Ok(())
}

#[tokio::test]
async fn schedule_advances_with_chain_time() -> anyhow::Result<()> {
    let (worker, contract, _owner) = setup().await?;
    let dao = worker.dev_create_account().await?;
    let alice = worker.dev_create_account().await?;
    let interval = 5u64;
    let plan_id: u64 = dao
        .call(contract.id(), "create_plan")
        .args_json(json!({"plan": plan_input(&[(&alice, ONE_NEAR)], interval)}))
        .deposit(NearToken::from_near(5))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .json()?;
    let t0 = now(&contract).await?;
    let res = dao.call(contract.id(), "run_due").args_json(json!({"plan_id": plan_id})).gas(Gas::from_tgas(300)).transact().await?;
    assert!(res.json::<Value>()?.get("Sent").is_some());
    let next: u64 = plan(&contract, plan_id).await?["next_run_at"].as_u64().unwrap();
    assert!(next >= t0 + interval - 1 && next <= t0 + interval + 1, "next_run_at {next} vs t0 {t0}");

    // Advance chain time well past the interval.
    worker.fast_forward(60).await?;
    if now(&contract).await? < next {
        // fast_forward may not advance timestamps enough on every sandbox build; wait on the wall clock.
        tokio::time::sleep(std::time::Duration::from_secs(interval + 2)).await;
        worker.fast_forward(5).await?;
    }
    assert!(now(&contract).await? >= next, "chain time did not advance");
    let is_due: bool = contract.view("is_due").args_json(json!({"plan_id": plan_id})).await?.json()?;
    assert!(is_due);
    let alice_before = balance(&alice).await?;
    let res = dao.call(contract.id(), "run_due").args_json(json!({"plan_id": plan_id})).gas(Gas::from_tgas(300)).transact().await?;
    let outcome: Value = res.json()?;
    assert_eq!(outcome["Sent"]["run_index"], 1, "{outcome}");
    assert_eq!(balance(&alice).await? - alice_before, ONE_NEAR);
    assert_eq!(plan(&contract, plan_id).await?["next_run_at"].as_u64().unwrap(), next + interval);
    Ok(())
}

#[tokio::test]
async fn failed_transfer_is_recredited() -> anyhow::Result<()> {
    let (worker, contract, _owner) = setup().await?;
    let dao = worker.dev_create_account().await?;
    let alice = worker.dev_create_account().await?;
    // A named account that does not exist: a native transfer to it fails.
    let ghost = "ghost-account-that-does-not-exist.test.near";
    let plan_id: u64 = dao
        .call(contract.id(), "create_plan")
        .args_json(json!({"plan": {
            "title": "with a ghost",
            "asset": "Near",
            "recipients": [
                {"account_id": alice.id(), "amount": ONE_NEAR.to_string()},
                {"account_id": ghost, "amount": ONE_NEAR.to_string()}
            ],
            "interval_seconds": 3600
        }}))
        .deposit(NearToken::from_near(5))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .json()?;
    let bal_before: u128 = plan(&contract, plan_id).await?["balance"].as_str().unwrap().parse()?;
    let res = dao.call(contract.id(), "run_due").args_json(json!({"plan_id": plan_id})).gas(Gas::from_tgas(300)).transact().await?;
    assert!(res.is_success(), "run_due itself must succeed even if one transfer fails: {:?}", res.failures());
    assert!(res.logs().iter().any(|l| l.contains("payout_failed")), "logs: {:?}", res.logs());
    let payouts: Vec<Value> = contract.view("get_payouts").args_json(json!({"plan_id": plan_id})).await?.json()?;
    assert_eq!(payouts[0]["status"], "Sent");
    assert_eq!(payouts[1]["status"], "Failed");
    let bal_after: u128 = plan(&contract, plan_id).await?["balance"].as_str().unwrap().parse()?;
    assert_eq!(bal_after, bal_before - ONE_NEAR, "only the successful payout is debited");
    // The run still completed and the schedule advanced.
    assert_eq!(plan(&contract, plan_id).await?["runs_completed"], 1);
    Ok(())
}

#[tokio::test]
async fn storage_deposit_is_required_and_private_callbacks_are_protected() -> anyhow::Result<()> {
    let (worker, contract, _owner) = setup().await?;
    let dao = worker.dev_create_account().await?;
    let alice = worker.dev_create_account().await?;
    let res = dao
        .call(contract.id(), "create_plan")
        .args_json(json!({"plan": plan_input(&[(&alice, ONE_NEAR)], 3600)}))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(res.is_failure());
    assert!(format!("{:?}", res.failures()).contains("Attach at least"));

    let res = dao
        .call(contract.id(), "on_payout")
        .args_json(json!({"plan_id": 1, "seq": 0, "amount": "1"}))
        .transact()
        .await?;
    assert!(res.is_failure());
    assert!(format!("{:?}", res.failures()).contains("private"), "{:?}", res.failures());
    Ok(())
}

#[tokio::test]
async fn large_run_splits_across_calls() -> anyhow::Result<()> {
    let (worker, contract, _owner) = setup().await?;
    let dao = worker.dev_create_account().await?;
    let mut recipients = Vec::new();
    for _ in 0..30 {
        recipients.push(worker.dev_create_account().await?);
    }
    let amt = ONE_NEAR / 10;
    let plan_id: u64 = dao
        .call(contract.id(), "create_plan")
        .args_json(json!({"plan": plan_input(&recipients.iter().map(|a| (a, amt)).collect::<Vec<_>>(), 3600)}))
        .deposit(NearToken::from_near(10))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .json()?;
    let before = balance(&recipients[29]).await?;
    let mut calls = 0;
    loop {
        let res = dao.call(contract.id(), "run_due").args_json(json!({"plan_id": plan_id})).gas(Gas::from_tgas(300)).transact().await?;
        assert!(res.is_success(), "{:?}", res.failures());
        let outcome: Value = res.json()?;
        calls += 1;
        if outcome["Sent"]["completed"] == true || outcome.get("NotDue").is_some() {
            break;
        }
        assert!(calls < 10, "too many calls: {outcome}");
    }
    assert_eq!(balance(&recipients[29]).await? - before, amt);
    let p = plan(&contract, plan_id).await?;
    assert_eq!(p["runs_completed"], 1);
    assert_eq!(p["payout_count"], 30);
    println!("30 recipients paid in {calls} call(s)");
    Ok(())
}
