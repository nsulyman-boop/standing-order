use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

/// What a plan pays out in.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Asset {
    /// Native NEAR, amounts in yoctoNEAR.
    Near,
    /// A NEP-141 fungible token, amounts in the token's base units.
    Ft { contract: AccountId },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recipient {
    pub account_id: AccountId,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanStatus {
    Active,
    Paused,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Plan {
    pub id: u64,
    /// The treasury (normally a Sputnik DAO account) that controls the plan.
    pub owner: AccountId,
    pub title: String,
    pub asset: Asset,
    pub recipients: Vec<Recipient>,
    /// Seconds between runs. The schedule stays aligned to `created_at`/`start_at`.
    pub interval_seconds: u64,
    /// Unix seconds. The next run may execute once `now >= next_run_at`.
    pub next_run_at: u64,
    /// Unix seconds. No run starts if `next_run_at > end_at`.
    pub end_at: Option<u64>,
    /// Upper bound on the sum paid in a single run (base units).
    pub cap_per_run: U128,
    /// Funds held for this plan (base units).
    pub balance: U128,
    pub status: PlanStatus,
    pub runs_completed: u32,
    /// When a run is split over several calls, the index of the next recipient to pay.
    pub run_cursor: Option<u32>,
    /// Total payout records created for this plan (sequence counter).
    pub payout_count: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Plan {
    pub fn total_per_run(&self) -> u128 {
        self.recipients
            .iter()
            .try_fold(0u128, |acc, r| acc.checked_add(r.amount.0))
            .expect("total overflow")
    }

    pub fn is_ended(&self) -> bool {
        matches!(self.end_at, Some(end) if self.next_run_at > end)
    }

    /// Due means: active, not ended, and either mid-run or past `next_run_at` with enough
    /// balance for a full run. Underfunded plans are not "due" so keepers do not poll them
    /// endlessly; `get_underfunded_plans` lists them instead.
    pub fn is_due(&self, now: u64) -> bool {
        self.status == PlanStatus::Active
            && !self.is_ended()
            && (self.run_cursor.is_some() || (now >= self.next_run_at && self.balance.0 >= self.total_per_run()))
    }

    /// Active, past its run time, but short of funds.
    pub fn is_underfunded(&self, now: u64) -> bool {
        self.status == PlanStatus::Active
            && !self.is_ended()
            && self.run_cursor.is_none()
            && now >= self.next_run_at
            && self.balance.0 < self.total_per_run()
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PlanInput {
    pub title: String,
    pub asset: Asset,
    pub recipients: Vec<Recipient>,
    pub interval_seconds: u64,
    /// Unix seconds of the first run. Defaults to now (first run is immediately due).
    pub start_at: Option<u64>,
    pub end_at: Option<u64>,
    /// Defaults to the sum of recipient amounts.
    pub cap_per_run: Option<U128>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, Default)]
pub struct PlanUpdate {
    pub title: Option<String>,
    pub recipients: Option<Vec<Recipient>>,
    pub cap_per_run: Option<U128>,
    pub interval_seconds: Option<u64>,
    pub end_at: Option<u64>,
    /// Set to true to remove an existing end date.
    pub clear_end_at: Option<bool>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutStatus {
    /// Transfer dispatched; waiting for the callback.
    Pending,
    Sent,
    /// Transfer failed; the amount was credited back to the plan balance.
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PayoutRecord {
    pub plan_id: u64,
    pub seq: u32,
    pub run_index: u32,
    pub recipient: AccountId,
    pub amount: U128,
    pub status: PayoutStatus,
    pub timestamp: u64,
    pub block_height: u64,
}

/// What `run_due` did.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunOutcome {
    NotDue { next_run_at: u64 },
    Paused,
    Cancelled,
    Ended,
    Underfunded { needed: U128, balance: U128 },
    /// Payouts were dispatched. `completed` is false when the run continues on the next call.
    Sent { run_index: u32, sent: u32, remaining: u32, completed: bool },
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner_id: AccountId,
    pub sponsor_storage: bool,
    pub min_interval_seconds: u64,
    pub max_recipients: u32,
    pub plan_count: u64,
}

/// Message accepted by `ft_on_transfer`.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
#[derive(Clone, Debug)]
pub enum FtMessage {
    FundPlan { plan_id: u64 },
    CreatePlan { plan: PlanInput },
}
