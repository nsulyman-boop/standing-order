import { useEffect, useMemo, useState } from "react";
import { Logo } from "./components/Logo";
import { PlanCard } from "./components/PlanCard";
import { PlanDetail } from "./components/PlanDetail";
import { Requests } from "./components/Requests";
import { DestinationPanel } from "./components/DestinationPanel";
import { CONTRACT, DAO, EXPLORER, KEEPER_URL, NETWORK, REPO_URL } from "./config";
import { formatAmount, formatCountdown, sum } from "./format";
import { getDaoProposals, getPlans, getTokenBalance, getTokenMeta, type Plan, type Proposal, type TokenMeta } from "./near";
import { useWallet } from "./wallet";

interface KeeperStatus {
  ok: boolean;
  runs: number;
  payoutsSent: number;
  lastTick: string | null;
  crosschain?: string;
  recent: Array<{ plan_id: number; outcome: any; tx: string }>;
}

export default function App() {
  const wallet = useWallet();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [treasury, setTreasury] = useState<string>("0");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [keeper, setKeeper] = useState<KeeperStatus | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [p, m, bal, props] = await Promise.all([getPlans(), getTokenMeta().catch(() => null), getTokenBalance(DAO).catch(() => "0"), getDaoProposals().catch(() => [])]);
        if (cancelled) return;
        setPlans(p);
        setMeta(m);
        setTreasury(bal);
        setProposals(props);
        setError(null);
        setLoaded(true);
        setSelected((s) => s ?? p.find((x) => x.status === "Active")?.id ?? p[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(String((e as any)?.message ?? e));
      }
      if (KEEPER_URL) {
        try {
          const r = await fetch(KEEPER_URL, { cache: "no-store" });
          if (!cancelled) setKeeper(await r.json());
        } catch {
          if (!cancelled) setKeeper(null);
        }
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const active = plans.filter((p) => p.status === "Active");
  const totalPaid = useMemo(() => {
    // Sum of completed runs × per-run total, per plan (payout records are per plan; this is the aggregate).
    return plans.filter((p) => p.asset !== "Near").reduce((acc, p) => acc + BigInt(p.runs_completed) * sum(p.recipients.map((r) => r.amount)), 0n);
  }, [plans]);
  const nextRun = active.filter((p) => !(p.end_at !== null && p.next_run_at > p.end_at)).map((p) => p.next_run_at).sort((a, b) => a - b)[0];
  const committed = active.reduce((acc, p) => acc + BigInt(p.balance), 0n);
  const selectedPlan = plans.find((p) => p.id === selected) ?? null;
  const keeperFresh = keeper?.lastTick ? Date.now() - new Date(keeper.lastTick).getTime() < 120_000 : false;

  return (
    <>
      <header className="header">
        <div className="wrap">
          <div className="brand"><Logo /> Standing Order</div>
          <span className="pill hide-sm"><span className="dot" style={{ background: NETWORK === "mainnet" ? "var(--green)" : "var(--purple)" }} />{NETWORK}</span>
          <a className="pill hide-sm mono" href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT} ↗</a>
          <div className="spacer" />
          <span className={`pill keeper ${keeper ? (keeperFresh ? "ok" : "bad") : ""}`} title={keeper?.lastTick ? `last tick ${keeper.lastTick}` : "keeper status endpoint not configured"}>
            <span className="dot" />
            <span className="text">{keeper ? (keeperFresh ? `Keeper live · ${keeper.runs} runs` : "Keeper stale") : "Keeper: no status"}</span>
          </span>
          {wallet.connected ? <button className="btn ghost sm" onClick={wallet.signOut}>{wallet.accountId.length > 22 ? wallet.accountId.slice(0, 20) + "…" : wallet.accountId}</button> : <button className="btn sm" onClick={wallet.signIn}>Connect</button>}
        </div>
      </header>

      <main className="wrap">
        <section className="hero">
          <span className="eyebrow">Recurring payroll for NEAR treasuries</span>
          <h1>Vote once. Pay every period. Settle on any chain.</h1>
          <p>
            A Sputnik DAO funds and authorises a plan in one vote. Standing Order pays each contributor on schedule, within the caps the council set,
            until the council pauses it. Recipients pick the token and chain they want; NEAR Intents does the delivery.
          </p>
        </section>

        <section className="stats">
          <div className="stat"><div className="label">Active plans</div><div className="value">{loaded ? active.length : "…"}</div><div className="sub">{plans.length} total on this contract</div></div>
          <div className="stat"><div className="label">Paid out so far</div><div className="value mono">{loaded ? formatAmount(totalPaid, meta, false) : "…"}</div><div className="sub">{plans.reduce((a, p) => a + p.runs_completed, 0)} runs completed</div></div>
          <div className="stat"><div className="label">Next payday</div><div className="value mono">{nextRun ? formatCountdown(nextRun, nowMs).text : "—"}</div><div className="sub">keeper triggers it automatically</div></div>
          <div className="stat"><div className="label">Committed in plans</div><div className="value mono">{loaded ? formatAmount(committed, meta, false) : "…"}</div><div className="sub">treasury holds {formatAmount(treasury, meta, false)}</div></div>
        </section>

        {error && <div className="note err-text" style={{ marginBottom: 16 }}>RPC error: {error}</div>}

        <section className="grid">
          <div className="col">
            <div>
              <div className="section-head"><h2>Plans</h2><span className="tiny">click a plan for history</span></div>
              <div className="col" style={{ gap: 12 }}>
                {!loaded && <div className="card empty">Loading plans from {CONTRACT}…</div>}
                {loaded && plans.length === 0 && <div className="card empty">No plans yet. A DAO creates one by voting on a funding proposal.</div>}
                {plans.slice().sort((a, b) => (a.status === "Active" ? -1 : 1) - (b.status === "Active" ? -1 : 1) || b.id - a.id).map((p) => (
                  <PlanCard key={p.id} plan={p} meta={meta} nowMs={nowMs} selected={p.id === selected} onSelect={() => setSelected(p.id)} />
                ))}
              </div>
            </div>
            {selectedPlan && <PlanDetail plan={selectedPlan} meta={meta} keeperRuns={keeper?.recent ?? []} />}
          </div>

          <div className="col">
            <Requests proposals={proposals} />
            <DestinationPanel accountId={wallet.accountId} connected={wallet.connected} onSignIn={wallet.signIn} onSignOut={wallet.signOut} call={wallet.call} />
            <div className="card pad">
              <h2 style={{ marginBottom: 12 }}>How it works</h2>
              <div className="steps" style={{ gridTemplateColumns: "1fr" }}>
                <div className="step"><div className="n">01 · one vote</div><b>The treasury funds a plan</b>The council approves a single proposal: token amount, recipients, cadence, cap. Trezu templates make it a form.</div>
                <div className="step"><div className="n">02 · code pays</div><b>Runs execute on schedule</b>A keeper with a key that can only call <code>run_due</code> triggers each period. No signatures on payday, no partial runs, failed transfers re-credit.</div>
                <div className="step"><div className="n">03 · any chain</div><b>Recipients choose where</b>Register a destination and the contract pays a 1Click deposit address it verified was signed for you. Refunds go to you.</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap row" style={{ justifyContent: "space-between" }}>
          <span>Standing Order · built at NEAR HACKATHON · Sputnik DAO + Trezu templates + function-call keys + NEAR Intents</span>
          <span className="row"><a href={REPO_URL} target="_blank" rel="noreferrer">Repository</a><a href={`${EXPLORER}/address/${DAO}`} target="_blank" rel="noreferrer">Demo DAO</a></span>
        </div>
      </footer>
    </>
  );
}
