//! Sandbox tests for fungible-token plans funded through `ft_transfer_call`
//! (the path a Sputnik DAO `Transfer` proposal with a `msg` takes).

use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{network::Sandbox, Account, Contract, Worker};
use serde_json::{json, Value};

const WASM_PATH: &str = "target/wasm32-unknown-unknown/release/standing_order.wasm";
const TOKEN_WASM_PATH: &str = "test-contracts/test-token/target/wasm32-unknown-unknown/release/test_token.wasm";
const USD: u128 = 1_000_000; // 6 decimals

struct Env {
    worker: Worker<Sandbox>,
    so: Contract,
    token: Contract,
    dao: Account,
}

async fn setup(sponsor_storage: bool) -> anyhow::Result<Env> {
    let wasm = std::fs::read(WASM_PATH).map_err(|e| anyhow::anyhow!("{WASM_PATH}: {e}; build the contract first"))?;
    let token_wasm = std::fs::read(TOKEN_WASM_PATH).map_err(|e| anyhow::anyhow!("{TOKEN_WASM_PATH}: {e}; build the test token first"))?;
    let worker = near_workspaces::sandbox().await?;
    let so = worker.dev_deploy(&wasm).await?;
    let token = worker.dev_deploy(&token_wasm).await?;
    let admin = worker.dev_create_account().await?;
    so.call("new")
        .args_json(json!({"owner_id": admin.id(), "sponsor_storage": sponsor_storage, "min_interval_seconds": 1}))
        .transact()
        .await?
        .into_result()?;
    token.call("new").args_json(json!({"decimals": 6})).transact().await?.into_result()?;
    let dao = worker.dev_create_account().await?;
    // The Standing Order contract must hold tokens, so it needs token storage.
    register(&token, &admin, so.id()).await?;
    token.call("mint").args_json(json!({"account_id": dao.id(), "amount": (10_000 * USD).to_string()})).transact().await?.into_result()?;
    Ok(Env { worker, so, token, dao })
}

async fn register(token: &Contract, payer: &Account, account: &near_workspaces::AccountId) -> anyhow::Result<()> {
    payer
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id": account, "registration_only": true}))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn ft_balance(token: &Contract, account: &near_workspaces::AccountId) -> anyhow::Result<u128> {
    let v: String = token.view("ft_balance_of").args_json(json!({"account_id": account})).await?.json()?;
    Ok(v.parse()?)
}

async fn plan(so: &Contract, id: u64) -> anyhow::Result<Value> {
    Ok(so.view("get_plan").args_json(json!({"plan_id": id})).await?.json()?)
}

fn create_msg(token: &Contract, recipients: &[(&near_workspaces::AccountId, u128)], interval: u64) -> String {
    json!({
        "action": "create_plan",
        "plan": {
            "title": "Contributors (tUSD)",
            "asset": {"Ft": {"contract": token.id()}},
            "recipients": recipients.iter().map(|(a, amt)| json!({"account_id": a, "amount": amt.to_string()})).collect::<Vec<_>>(),
            "interval_seconds": interval
        }
    })
    .to_string()
}

async fn transfer_call(env: &Env, amount: u128, msg: String) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(env
        .dao
        .call(env.token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": env.so.id(), "amount": amount.to_string(), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?)
}

#[tokio::test]
async fn create_fund_pay_and_cancel_with_tokens() -> anyhow::Result<()> {
    let env = setup(true).await?;
    let alice = env.worker.dev_create_account().await?;
    let bob = env.worker.dev_create_account().await?; // deliberately NOT registered on the token
    register(&env.token, &env.dao, alice.id()).await?;

    // 1. One ft_transfer_call creates and funds the plan (sponsored storage).
    let res = transfer_call(&env, 300 * USD, create_msg(&env.token, &[(alice.id(), 100 * USD), (bob.id(), 50 * USD)], 3600)).await?;
    assert!(res.is_success(), "{:?}", res.failures());
    let used: String = res.json()?;
    assert_eq!(used, (300 * USD).to_string(), "the contract keeps the whole transfer");
    assert_eq!(ft_balance(&env.token, env.so.id()).await?, 300 * USD);
    assert_eq!(ft_balance(&env.token, env.dao.id()).await?, 9_700 * USD);
    let p = plan(&env.so, 1).await?;
    assert_eq!(p["owner"], env.dao.id().to_string());
    assert_eq!(p["balance"], (300 * USD).to_string());
    assert_eq!(p["asset"]["Ft"]["contract"], env.token.id().to_string());

    // 2. Top up through fund_plan.
    let res = transfer_call(&env, 50 * USD, json!({"action": "fund_plan", "plan_id": 1}).to_string()).await?;
    assert!(res.is_success(), "{:?}", res.failures());
    assert_eq!(plan(&env.so, 1).await?["balance"], (350 * USD).to_string());

    // 3. run_due: alice is paid, bob (unregistered) fails and is re-credited.
    let keeper = env.worker.dev_create_account().await?;
    let res = keeper.call(env.so.id(), "run_due").args_json(json!({"plan_id": 1})).gas(Gas::from_tgas(300)).transact().await?;
    assert!(res.is_success(), "{:?}", res.failures());
    let logs = res.logs().iter().map(|l| l.to_string()).collect::<Vec<_>>();
    let outcome: Value = res.json()?;
    assert_eq!(outcome["Sent"]["sent"], 2, "{outcome}");
    assert_eq!(ft_balance(&env.token, alice.id()).await?, 100 * USD);
    assert_eq!(ft_balance(&env.token, env.so.id()).await?, 250 * USD, "only alice's payout left the contract");
    let payouts: Vec<Value> = env.so.view("get_payouts").args_json(json!({"plan_id": 1})).await?.json()?;
    assert_eq!(payouts[0]["status"], "Sent");
    assert_eq!(payouts[1]["status"], "Failed", "{payouts:?}");
    assert!(logs.iter().any(|l| l.contains("payout_failed")), "{logs:?}");
    let p = plan(&env.so, 1).await?;
    assert_eq!(p["balance"], (250 * USD).to_string(), "bob's 50 was credited back");
    assert_eq!(p["runs_completed"], 1);

    // 4. Cancel sweeps the remaining tokens back to the DAO.
    let res = env.dao.call(env.so.id(), "cancel_plan").args_json(json!({"plan_id": 1})).gas(Gas::from_tgas(100)).transact().await?;
    assert!(res.is_success(), "{:?}", res.failures());
    assert_eq!(ft_balance(&env.token, env.dao.id()).await?, 9_700 * USD - 50 * USD + 250 * USD);
    assert_eq!(ft_balance(&env.token, env.so.id()).await?, 0);
    assert_eq!(plan(&env.so, 1).await?["status"], "Cancelled");
    Ok(())
}

#[tokio::test]
async fn bad_transfers_are_refunded() -> anyhow::Result<()> {
    let env = setup(true).await?;
    let alice = env.worker.dev_create_account().await?;
    let before = ft_balance(&env.token, env.dao.id()).await?;

    // Garbage msg -> refund.
    let res = transfer_call(&env, 10 * USD, "hello".into()).await?;
    assert!(res.is_success(), "ft_transfer_call itself succeeds; the receiver refunds: {:?}", res.failures());
    assert_eq!(ft_balance(&env.token, env.dao.id()).await?, before);
    assert_eq!(ft_balance(&env.token, env.so.id()).await?, 0);

    // Funding a plan that does not exist -> refund.
    let res = transfer_call(&env, 10 * USD, json!({"action": "fund_plan", "plan_id": 42}).to_string()).await?;
    assert!(res.is_success());
    assert_eq!(ft_balance(&env.token, env.dao.id()).await?, before);

    // Plan asset that names a different token -> refund.
    let other: near_workspaces::AccountId = "other-token.test.near".parse()?;
    let msg = json!({"action": "create_plan", "plan": {"title": "x", "asset": {"Ft": {"contract": other}}, "recipients": [{"account_id": alice.id(), "amount": "1"}], "interval_seconds": 3600}}).to_string();
    let res = transfer_call(&env, 10 * USD, msg).await?;
    assert!(res.is_success());
    assert_eq!(ft_balance(&env.token, env.dao.id()).await?, before);
    let plans: Vec<Value> = env.so.view("get_plans").args_json(json!({})).await?.json()?;
    assert!(plans.is_empty(), "no plan should have been created");

    // Native NEAR top-up of a token plan is rejected.
    transfer_call(&env, 10 * USD, create_msg(&env.token, &[(alice.id(), USD)], 3600)).await?.into_result()?;
    let res = env.dao.call(env.so.id(), "fund_plan").args_json(json!({"plan_id": 1})).deposit(NearToken::from_near(1)).transact().await?;
    assert!(res.is_failure());
    assert!(format!("{:?}", res.failures()).contains("not funded in NEAR"));
    Ok(())
}

#[tokio::test]
async fn storage_credits_are_required_when_not_sponsored() -> anyhow::Result<()> {
    let env = setup(false).await?;
    let alice = env.worker.dev_create_account().await?;
    let before = ft_balance(&env.token, env.dao.id()).await?;

    // Without credits the create is refused and the tokens come back.
    let res = transfer_call(&env, 10 * USD, create_msg(&env.token, &[(alice.id(), USD)], 3600)).await?;
    assert!(res.is_success());
    assert_eq!(ft_balance(&env.token, env.dao.id()).await?, before);
    assert!(format!("{:?}", res.receipt_failures()).contains("Insufficient storage credits"), "{:?}", res.receipt_failures());

    // Prepay storage, then it works and the credit is drawn down.
    env.dao.call(env.so.id(), "storage_deposit").args_json(json!({})).deposit(NearToken::from_millinear(100)).transact().await?.into_result()?;
    let res = transfer_call(&env, 10 * USD, create_msg(&env.token, &[(alice.id(), USD)], 3600)).await?;
    assert!(res.is_success(), "{:?}", res.failures());
    assert_eq!(ft_balance(&env.token, env.so.id()).await?, 10 * USD);
    let credit: String = env.so.view("storage_credit_of").args_json(json!({"account_id": env.dao.id()})).await?.json()?;
    let credit: u128 = credit.parse()?;
    assert!(credit < NearToken::from_millinear(100).as_yoctonear() && credit > 0, "credit should be partially consumed: {credit}");
    Ok(())
}
