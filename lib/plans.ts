// Farm plans. One plan per protocol, built from what the snapshot records: category picks the kind (steps, number of
// transactions, minutes, main risk), TVL picks the capital tier, the first listed chain picks the gas range, age picks
// the hold and 7-day growth picks the exit trigger. Plans describe ordinary use of a protocol by one person with one
// wallet; gas ranges and hours are assumptions (see ASSUME in dashboard/engine.js), not snapshot figures.
import { createRequire } from 'node:module';
import type { Protocol } from './model.ts';

const engine = createRequire(import.meta.url)('../dashboard/engine.js');

export interface Kind {
  label: string;
  mult: number; // capital multiplier on the TVL tier
  tx: [number, number, number]; // transactions in the first action, the second action and each weekly use
  mins: [number, number, number]; // minutes for the same three
  cap?: number; // longest hold in days
  check: string;
  a1: string;
  a2: string;
  weekly: string;
  risk: string;
}

export const KINDS: Record<string, Kind> = {
  credit: { label: 'Lending', mult: 1, tx: [3, 2, 1], mins: [25, 20, 10], check: 'Check the supported collateral, the borrow rate and whether the app lists a points or rewards page.', a1: 'Supply stablecoins to its largest market, then borrow a small amount against them', a2: 'Repay part of the loan and withdraw part of the supply', weekly: 'check your health factor and top up or repay a little', risk: 'liquidation if the collateral falls; keep the loan under a quarter of the supply' },
  cdp: { label: 'Collateralised stable asset', mult: 1, tx: [3, 2, 1], mins: [25, 20, 10], check: 'Check the accepted collateral, the minimum debt and the stability fee.', a1: 'Deposit collateral and mint a small amount of the protocol stable asset at a very safe ratio', a2: 'Move the minted asset into the protocol\'s own savings or pool product', weekly: 'check the collateral ratio and add collateral if it drifts toward the limit', risk: 'liquidation, and the minted asset losing its peg' },
  dex: { label: 'Exchange', mult: 0.75, tx: [4, 3, 1], mins: [20, 25, 10], check: 'Check the main pairs, the fee tiers and whether the volume looks like real use.', a1: 'Swap through the main pair at three different sizes', a2: 'Add liquidity to the deepest pool and keep the position open', weekly: 'make one swap or check the pool position', risk: 'impermanent loss and price moves in the pooled tokens' },
  lp: { label: 'Managed liquidity', mult: 1, tx: [2, 3, 1], mins: [20, 20, 8], check: 'Check which pools the manager runs, its fee history and its withdrawal terms.', a1: 'Deposit into the managed liquidity vault with the highest TVL', a2: 'Withdraw a slice, redeposit it and compound once if the app offers it', weekly: 'check the position range and compound if the app offers it', risk: 'impermanent loss and strategy losses' },
  vault: { label: 'Vault or aggregator', mult: 1, tx: [2, 2, 1], mins: [20, 20, 8], check: 'Check the strategy descriptions, the fees and the withdrawal terms of each vault.', a1: 'Deposit stablecoins into the vault with the most TVL and keep the vault shares', a2: 'Add a smaller deposit in a different vault so you see two strategies', weekly: 'check the share price and add a little to a deposit', risk: 'strategy losses and withdrawal limits' },
  yield: { label: 'Yield', mult: 1, tx: [2, 3, 1], mins: [20, 25, 8], check: 'Check where the yield comes from, the lock terms and the audit notes.', a1: 'Deposit stablecoins into the main yield product and keep the receipt token', a2: 'Use the receipt token in the protocol\'s own second product, such as a pool or a lock', weekly: 'check the receipt token\'s value and add a little', risk: 'the yield-bearing asset losing its peg, and lock-up periods' },
  rwa: { label: 'Real-world assets', mult: 1.5, tx: [3, 2, 1], mins: [40, 20, 8], check: 'Check who may buy, the minimum ticket and the redemption terms; some products ask for identity checks.', a1: 'Complete the onboarding if it asks, then buy a small amount of the yield-bearing token', a2: 'Request redemption of a small slice to learn the real exit time', weekly: 'compare the token price with its stated net asset value', risk: 'issuer and redemption risk, and identity checks you may not want to complete' },
  perp: { label: 'Derivatives', mult: 0.5, cap: 30, tx: [3, 3, 2], mins: [25, 25, 12], check: 'Check the fee schedule, the liquidation rules and which asset is posted as margin.', a1: 'Deposit margin and open one small position at low leverage', a2: 'Close it and open one on a second market', weekly: 'open and close one small position', risk: 'liquidation and funding costs; stay at or under 2x leverage' },
  stake: { label: 'Staking', mult: 1.25, tx: [2, 2, 1], mins: [20, 20, 8], check: 'Check the lock and unbonding periods, the fees and the slashing rules.', a1: 'Stake or restake the main asset and keep the receipt token', a2: 'Delegate the receipt token to a second operator or pool if the app allows it', weekly: 'claim rewards and stake them again if the app has that', risk: 'unbonding delay, slashing and the receipt token losing its peg' },
  bridge: { label: 'Bridge', mult: 0.5, cap: 30, tx: [3, 3, 2], mins: [20, 20, 10], check: 'Check the supported routes, the fees and the documented way to recover stuck funds.', a1: 'Bridge a small amount of a stable asset in through the protocol', a2: 'Bridge a slice back out, so both directions are used', weekly: 'move a small amount once, in either direction', risk: 'a bridge contract failure and long delays' },
  cover: { label: 'Cover', mult: 0.5, cap: 30, tx: [2, 2, 1], mins: [25, 15, 8], check: 'Check what the cover excludes, how claims are paid and how long a policy runs.', a1: 'Buy a small policy or deposit into its underwriting pool', a2: 'Renew or extend the position once', weekly: 'check the policy or pool status', risk: 'a payout event on a pool you underwrite, and a policy that expires' },
  predict: { label: 'Prediction market', mult: 0.4, cap: 30, tx: [3, 3, 2], mins: [20, 20, 10], check: 'Check the market rules, the resolution source and the fees.', a1: 'Fund the account and place a small position in a liquid market', a2: 'Place a second position in another market and close one early', weekly: 'place one small position in a market you have a view on', risk: 'losing the whole stake when a market resolves' },
  pay: { label: 'Payments', mult: 0.25, cap: 30, tx: [2, 2, 1], mins: [30, 15, 8], check: 'Check the supported countries, the fees and the identity check.', a1: 'Create the account or card, load a small balance and make one real payment', a2: 'Make a second payment on another day and top up once', weekly: 'make one payment you would make anyway', risk: 'account verification, fees and a frozen balance' },
  other: { label: 'Other', mult: 1, tx: [2, 2, 1], mins: [20, 20, 8], check: 'Read what the product does and how it is meant to be used.', a1: 'Deposit a small amount into the protocol\'s main product and keep the receipt', a2: 'Use the second most used feature in the app once', weekly: 'use the main feature once', risk: 'smart contract risk and a product that changes without notice' }
};

export function kindOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (/lend|borrow|uncollateral/.test(c)) return 'credit';
  if (/cdp|collateral|dual-token|stablecoin|anchor|decentralized btc/.test(c)) return 'cdp';
  if (/dex|swap|launchpad|farm/.test(c)) return 'dex';
  if (/liquidity manager|leveraged/.test(c)) return 'lp';
  if (/curator|allocator|aggregator|vault|index|cedefi/.test(c)) return 'vault';
  if (/yield|basis/.test(c)) return 'yield';
  if (/rwa|marketplace/.test(c)) return 'rwa';
  if (/perp|deriv|option|rate/.test(c)) return 'perp';
  if (/restak|staking|stake/.test(c)) return 'stake';
  if (/bridge/.test(c)) return 'bridge';
  if (/insur/.test(c)) return 'cover';
  if (/predict/.test(c)) return 'predict';
  if (/payment|card|governance/.test(c)) return 'pay';
  return 'other';
}

/** The capital tier: a function of TVL alone, so the same position is a smaller share of a larger protocol. */
export const TIERS: Array<[number, number]> = [[2e7, 200], [1e8, 500], [5e8, 1000], [Infinity, 2000]];

const money = (v: number): string => (v >= 10 ? `$${Math.round(v)}` : v >= 0.01 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
const range = (lo: number, hi: number): string => (money(lo) === money(hi) ? money(lo) : `${money(lo)} to ${money(hi)}`);

export interface Plan {
  kind: string;
  chain: string;
  capital: number;
  gas_lo: number;
  gas_hi: number;
  hold_days: number;
  hours: number;
  risk: string;
  steps: Array<{ text: string; t: string; c: string; m: string }>;
}

export function farmPlan(p: Protocol, asOf: string): Plan {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const [glo, ghi] = engine.gasRange(chain) as [number, number];
  const age: number | null = engine.ageDays(asOf, p.listed_at);
  const kind = kindOf(p.category), k = KINDS[kind]!;
  const base = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const hold = Math.min(base, k.cap ?? 60), weeks = Math.ceil(hold / 7);
  const tier = TIERS.find(([top]) => p.tvl_usd < top)![1];
  const capital = Math.max(50, Math.round((tier * k.mult) / 50) * 50);
  const growth = p.change_7d;
  const trigger = growth !== null && growth < -10 ? `TVL falls 15% from your entry reading (it already fell ${Math.abs(growth).toFixed(1)}% this week, so the trigger is tight)` : 'TVL falls 25% from your entry reading';
  const gas = (n: number): string => `${range(n * glo, n * ghi)} of gas for ${n} transaction${n === 1 ? '' : 's'}`;
  const [t1, t2, tw] = k.tx, [m1, m2, mw] = k.mins;
  const rows: Array<{ t: string; c: string; m: string; tx: number; min: number }> = [
    { t: `Open defillama.com/protocol/${p.slug} and the protocol's own site, and check that it still shows no token. ${k.check} Save the official domain.`, c: '$0', m: '20 minutes', tx: 0, min: 20 },
    { t: `Use one wallet that you control and that holds only the farm funds: ${money(capital)} for the position plus gas on ${chain}. Keep the seed phrase offline. Read the protocol's terms first; some limit one account per person.`, c: gas(2), m: '15 minutes', tx: 2, min: 15 },
    { t: `${k.a1}, on ${chain}, using ${money(capital)} as the position.`, c: `${gas(t1)}, ${money(capital)} locked`, m: `${m1} minutes`, tx: t1, min: m1 },
    { t: `${k.a2}.`, c: gas(t2), m: `${m2} minutes`, tx: t2, min: m2 },
    { t: `For ${weeks} weeks, use it the way a regular user would, once a week: ${k.weekly}.`, c: `${gas(tw * weeks)}`, m: `${mw * weeks} minutes in all`, tx: tw * weeks, min: mw * weeks },
    { t: `Hold the position for ${hold} days${age === null ? ' (its age is unknown, so the shortest window)' : age < 180 ? ` (it is ${age} days old with no token)` : ` (it has run ${age} days with no token)`}. A snapshot or claim window can come at any time, or never.`, c: `${money(capital)} stays locked`, m: `${hold} days`, tx: 0, min: 0 },
    { t: `Check TVL weekly on its DefiLlama page and withdraw if ${trigger}, or if the site or contracts change without notice. Main risk for this kind of product: ${k.risk}.`, c: `$0 to check, ${gas(2)} to exit`, m: `5 minutes a week`, tx: 2, min: 5 * weeks },
    { t: 'If a claim opens, use only the link on the official site, never a link sent to you, and sign nothing that asks for approval of all your tokens. Nothing may ever open.', c: `${gas(1)}; never pay to claim`, m: '15 minutes', tx: 1, min: 15 }
  ];
  const txs = rows.reduce((s, r) => s + r.tx, 0), minutes = rows.reduce((s, r) => s + r.min, 0);
  const steps = rows.map((r) => {
    const text = `${r.t} Cost: ${r.c}. Time: ${r.m}.`;
    return { text: text.length > 600 ? `${text.slice(0, 596)}...` : text, t: r.t, c: r.c, m: r.m };
  });
  const r2 = (v: number): number => Math.round(v * 1000) / 1000;
  return { kind, chain, capital, gas_lo: r2(txs * glo), gas_hi: r2(txs * ghi), hold_days: hold, hours: Math.round((minutes / 60) * 10) / 10, risk: k.risk, steps };
}

/** What the Model tab shows about the plans: one row per kind, from the same table the plans use. */
export function kindTable(): Array<{ kind: string; label: string; mult: number; tx: number[]; mins: number[]; cap: number; risk: string }> {
  return Object.entries(KINDS).map(([kind, k]) => ({ kind, label: k.label, mult: k.mult, tx: k.tx, mins: k.mins, cap: k.cap ?? 60, risk: k.risk }));
}
