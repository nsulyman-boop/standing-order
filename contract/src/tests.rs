use super::*;
use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, Gas, NearToken};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn ctx(predecessor: AccountId, deposit: u128, ts_seconds: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(accounts(0))
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts_seconds * 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300));
    b
}

fn dao() -> AccountId {
    accounts(1)
}

fn recipient(i: usize) -> AccountId {
    format!("r{}.test.near", i).parse().unwrap()
}

fn input(interval: u64, amounts: &[u128]) -> PlanInput {
    PlanInput {
        title: "Core team payroll".into(),
        asset: Asset::Near,
        recipients: amounts
            .iter()
            .enumerate()
            .map(|(i, a)| Recipient { account_id: recipient(i), amount: U128(*a) })
            .collect(),
        interval_seconds: interval,
        start_at: None,
        end_at: None,
        cap_per_run: None,
    }
}

fn new_contract() -> Contract {
    testing_env!(ctx(accounts(0), 0, 1_000).build());
    Contract::new(accounts(0), true, Some(60))
}

#[test]
fn create_native_plan_funds_from_deposit() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 5 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR, 2 * NEAR]));
    let plan = c.get_plan(id).unwrap();
    assert_eq!(plan.owner, dao());
    assert_eq!(plan.next_run_at, 1_000, "first run is due immediately by default");
    assert_eq!(plan.cap_per_run.0, 3 * NEAR, "cap defaults to the recipients total");
    // The mocked VM does not meter storage, so the whole deposit becomes balance here;
    // real storage charging is covered by the sandbox tests.
    assert!(plan.balance.0 <= 5 * NEAR && plan.balance.0 > 4 * NEAR, "deposit minus storage becomes balance");
    assert!(get_logs().iter().any(|l| l.contains("plan_created")));
    assert_eq!(c.get_plans_by_owner(dao()).len(), 1);
    assert_eq!(c.get_config().plan_count, 1);
}

#[test]
#[should_panic(expected = "interval_seconds must be at least")]
fn create_plan_rejects_short_interval() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), NEAR, 1_000).build());
    c.create_plan(input(5, &[NEAR]));
}

#[test]
#[should_panic(expected = "Recipients total exceeds cap_per_run")]
fn create_plan_rejects_total_above_cap() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), NEAR, 1_000).build());
    let mut i = input(3600, &[NEAR, NEAR]);
    i.cap_per_run = Some(U128(NEAR));
    c.create_plan(i);
}

#[test]
fn run_due_pays_once_per_period_and_advances_schedule() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR, 2 * NEAR]));
    let before = c.get_plan(id).unwrap().balance.0;

    testing_env!(ctx(accounts(5), 0, 1_000).build()); // anyone can trigger
    let out = c.run_due(id, None);
    assert_eq!(out, RunOutcome::Sent { run_index: 0, sent: 2, remaining: 0, completed: true });
    let plan = c.get_plan(id).unwrap();
    assert_eq!(plan.balance.0, before - 3 * NEAR);
    assert_eq!(plan.next_run_at, 4_600);
    assert_eq!(plan.runs_completed, 1);
    assert_eq!(plan.payout_count, 2);
    let payouts = c.get_payouts(id, None, None);
    assert_eq!(payouts.len(), 2);
    assert_eq!(payouts[1].recipient, recipient(1));
    assert_eq!(payouts[1].status, PayoutStatus::Pending);

    // Same period again: nothing happens.
    assert_eq!(c.run_due(id, None), RunOutcome::NotDue { next_run_at: 4_600 });
    assert_eq!(c.get_plan(id).unwrap().balance.0, before - 3 * NEAR);
    assert!(!c.is_due(id));

    // Two periods later: catch-up pays one period per call, schedule stays aligned.
    testing_env!(ctx(accounts(5), 0, 9_000).build());
    assert!(c.is_due(id));
    assert_eq!(c.get_due_plans(None), vec![id]);
    assert!(matches!(c.run_due(id, None), RunOutcome::Sent { run_index: 1, completed: true, .. }));
    assert_eq!(c.get_plan(id).unwrap().next_run_at, 8_200);
    assert!(matches!(c.run_due(id, None), RunOutcome::Sent { run_index: 2, completed: true, .. }));
    assert_eq!(c.get_plan(id).unwrap().next_run_at, 11_800);
    assert_eq!(c.run_due(id, None), RunOutcome::NotDue { next_run_at: 11_800 });
}

#[test]
fn run_due_refuses_partial_runs_when_underfunded() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 2 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR, 2 * NEAR]));
    testing_env!(ctx(accounts(5), 0, 1_000).build());
    let out = c.run_due(id, None);
    assert!(matches!(out, RunOutcome::Underfunded { needed, .. } if needed.0 == 3 * NEAR));
    assert!(!c.is_due(id), "underfunded plans are not due, so keepers stop polling them");
    assert!(c.get_due_plans(None).is_empty());
    assert_eq!(c.get_underfunded_plans(None), vec![id]);
    let plan = c.get_plan(id).unwrap();
    assert_eq!(plan.runs_completed, 0);
    assert_eq!(plan.payout_count, 0);
    assert!(get_logs().iter().any(|l| l.contains("plan_underfunded")));

    // Top up and it pays.
    testing_env!(ctx(dao(), 2 * NEAR, 1_000).build());
    c.fund_plan(id);
    assert!(c.get_underfunded_plans(None).is_empty());
    assert_eq!(c.get_due_plans(None), vec![id]);
    testing_env!(ctx(accounts(5), 0, 1_000).build());
    assert!(matches!(c.run_due(id, None), RunOutcome::Sent { completed: true, .. }));
}

#[test]
fn failed_payout_recredits_balance() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    testing_env!(ctx(accounts(5), 0, 1_000).build());
    c.run_due(id, None);
    let after_send = c.get_plan(id).unwrap().balance.0;

    // Callback runs as the contract itself.
    testing_env!(ctx(accounts(0), 0, 1_001).build());
    c.on_payout(id, 0, U128(NEAR), Err(PromiseError::Failed));
    assert_eq!(c.get_plan(id).unwrap().balance.0, after_send + NEAR);
    assert_eq!(c.get_payouts(id, None, None)[0].status, PayoutStatus::Failed);
    assert!(get_logs().iter().any(|l| l.contains("payout_failed")));
}

#[test]
fn successful_payout_marks_sent() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    testing_env!(ctx(accounts(5), 0, 1_000).build());
    c.run_due(id, None);
    testing_env!(ctx(accounts(0), 0, 1_001).build());
    c.on_payout(id, 0, U128(NEAR), Ok(()));
    assert_eq!(c.get_payouts(id, None, None)[0].status, PayoutStatus::Sent);
}

#[test]
fn pause_blocks_runs_and_resume_restores() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    c.pause_plan(id);
    assert_eq!(c.get_plan(id).unwrap().status, PlanStatus::Paused);
    assert!(c.get_due_plans(None).is_empty());
    testing_env!(ctx(accounts(5), 0, 5_000).build());
    assert_eq!(c.run_due(id, None), RunOutcome::Paused);
    testing_env!(ctx(dao(), 0, 5_000).build());
    c.resume_plan(id, None);
    testing_env!(ctx(accounts(5), 0, 5_000).build());
    assert!(matches!(c.run_due(id, None), RunOutcome::Sent { .. }));
}

#[test]
#[should_panic(expected = "Only the plan owner can do this")]
fn only_owner_can_pause() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    testing_env!(ctx(accounts(5), 0, 1_000).build());
    c.pause_plan(id);
}

#[test]
fn cancel_sweeps_balance_and_stops_runs() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    let promise = c.cancel_plan(id);
    assert!(promise.is_some(), "a transfer back to the owner is scheduled");
    let plan = c.get_plan(id).unwrap();
    assert_eq!(plan.status, PlanStatus::Cancelled);
    assert_eq!(plan.balance.0, 0);
    assert!(get_logs().iter().any(|l| l.contains("plan_swept")));
    testing_env!(ctx(accounts(5), 0, 9_000).build());
    assert_eq!(c.run_due(id, None), RunOutcome::Cancelled);
}

#[test]
fn partial_sweep_keeps_plan_active() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    let before = c.get_plan(id).unwrap().balance.0;
    c.sweep(id, Some(U128(NEAR)));
    let plan = c.get_plan(id).unwrap();
    assert_eq!(plan.balance.0, before - NEAR);
    assert_eq!(plan.status, PlanStatus::Active);
}

#[test]
#[should_panic(expected = "Sweep amount exceeds balance")]
fn sweep_cannot_exceed_balance() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 2 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    c.sweep(id, Some(U128(5 * NEAR)));
}

#[test]
fn end_date_stops_runs_after_last_period() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let mut i = input(3600, &[NEAR]);
    i.start_at = Some(1_000);
    i.end_at = Some(4_600); // exactly two runs: t=1000 and t=4600
    let id = c.create_plan(i);
    testing_env!(ctx(accounts(5), 0, 20_000).build());
    assert!(matches!(c.run_due(id, None), RunOutcome::Sent { run_index: 0, .. }));
    assert!(matches!(c.run_due(id, None), RunOutcome::Sent { run_index: 1, .. }));
    assert_eq!(c.run_due(id, None), RunOutcome::Ended);
    assert!(c.get_due_plans(None).is_empty());
}

#[test]
fn update_plan_changes_recipients_and_enforces_cap() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    testing_env!(ctx(dao(), NEAR, 1_000).build());
    c.update_plan(
        id,
        PlanUpdate {
            recipients: Some(vec![
                Recipient { account_id: recipient(0), amount: U128(NEAR) },
                Recipient { account_id: recipient(1), amount: U128(NEAR / 2) },
            ]),
            cap_per_run: Some(U128(2 * NEAR)),
            interval_seconds: Some(7200),
            end_at: Some(100_000),
            ..Default::default()
        },
    );
    let plan = c.get_plan(id).unwrap();
    assert_eq!(plan.recipients.len(), 2);
    assert_eq!(plan.interval_seconds, 7200);
    assert_eq!(plan.end_at, Some(100_000));
    assert_eq!(plan.total_per_run(), NEAR + NEAR / 2);
}

#[test]
#[should_panic(expected = "Recipients total exceeds cap_per_run")]
fn update_plan_rejects_recipients_over_cap() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    testing_env!(ctx(dao(), NEAR, 1_000).build());
    c.update_plan(
        id,
        PlanUpdate {
            recipients: Some(vec![Recipient { account_id: recipient(0), amount: U128(3 * NEAR) }]),
            ..Default::default()
        },
    );
}

#[test]
fn large_runs_continue_across_calls_when_gas_is_short() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 100 * NEAR, 1_000).build());
    let amounts = vec![NEAR / 10; 40];
    let id = c.create_plan(input(3600, &amounts));
    // Give only enough gas for a handful of payouts per call.
    let mut b = ctx(accounts(5), 0, 1_000);
    b.prepaid_gas(Gas::from_tgas(80));
    testing_env!(b.build());
    let first = c.run_due(id, None);
    let RunOutcome::Sent { sent, remaining, completed, run_index } = first else { panic!("expected Sent") };
    assert_eq!(run_index, 0);
    assert!(sent > 0 && !completed && remaining == 40 - sent, "run should be split: {:?}", first);
    assert!(c.get_plan(id).unwrap().run_cursor.is_some());
    assert!(c.is_due(id), "mid-run plans stay due");

    let mut total_sent = sent;
    let mut guard = 0;
    while c.get_plan(id).unwrap().run_cursor.is_some() {
        let mut b = ctx(accounts(5), 0, 1_000);
        b.prepaid_gas(Gas::from_tgas(80));
        testing_env!(b.build());
        if let RunOutcome::Sent { sent, .. } = c.run_due(id, None) {
            total_sent += sent;
        }
        guard += 1;
        assert!(guard < 50, "run never completed");
    }
    assert_eq!(total_sent, 40);
    let plan = c.get_plan(id).unwrap();
    assert_eq!(plan.runs_completed, 1);
    assert_eq!(plan.payout_count, 40);
    assert_eq!(plan.next_run_at, 4_600);
}

#[test]
#[should_panic(expected = "Cannot update a plan mid-run")]
fn cannot_update_mid_run() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 100 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &vec![NEAR / 10; 40]));
    let mut b = ctx(accounts(5), 0, 1_000);
    b.prepaid_gas(Gas::from_tgas(80));
    testing_env!(b.build());
    c.run_due(id, None);
    testing_env!(ctx(dao(), NEAR, 1_000).build());
    c.update_plan(id, PlanUpdate { title: Some("x".into()), ..Default::default() });
}

#[test]
fn storage_deposit_tracks_credits() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), NEAR, 1_000).build());
    assert_eq!(c.storage_deposit(None).0, NEAR);
    assert_eq!(c.storage_credit_of(dao()).0, NEAR);
}

#[test]
fn only_contract_owner_sets_config() {
    let mut c = new_contract();
    testing_env!(ctx(accounts(0), 0, 1_000).build());
    c.set_config(Some(false), Some(10), Some(5), None);
    let cfg = c.get_config();
    assert!(!cfg.sponsor_storage);
    assert_eq!(cfg.min_interval_seconds, 10);
    assert_eq!(cfg.max_recipients, 5);
}

#[test]
fn resume_can_skip_missed_periods() {
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    c.pause_plan(id);
    // Three periods later: resume with skip_missed → next run is the next aligned slot, no back pay.
    testing_env!(ctx(dao(), 0, 1_000 + 3 * 3600 + 100).build());
    c.resume_plan(id, Some(true));
    let plan = c.get_plan(id).unwrap();
    assert_eq!(plan.next_run_at, 1_000 + 4 * 3600);
    assert!(!c.is_due(id));

    // Default resume keeps back pay.
    let mut c = new_contract();
    testing_env!(ctx(dao(), 10 * NEAR, 1_000).build());
    let id = c.create_plan(input(3600, &[NEAR]));
    c.pause_plan(id);
    testing_env!(ctx(dao(), 0, 1_000 + 3 * 3600 + 100).build());
    c.resume_plan(id, None);
    assert_eq!(c.get_plan(id).unwrap().next_run_at, 1_000);
    assert!(c.is_due(id));
}

#[test]
fn register_destination_requires_intents_asset_id() {
    let mut c = new_contract();
    testing_env!(ctx(accounts(2), NEAR / 10, 1_000).build());
    c.register_destination("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near".into(), "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045".into());
    let d = c.get_destination(accounts(2)).unwrap();
    assert_eq!(d.address, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    c.clear_destination();
    assert!(c.get_destination(accounts(2)).is_none());
}

#[test]
#[should_panic(expected = "asset_id must be a NEAR Intents asset id")]
fn register_destination_rejects_bad_asset() {
    let mut c = new_contract();
    testing_env!(ctx(accounts(2), NEAR / 10, 1_000).build());
    c.register_destination("base-usdc".into(), "0xabc".into());
}
