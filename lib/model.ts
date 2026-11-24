// Board assembly for the token radar: snapshot in, ranked board and dashboard data out.
// The value model and the farm plans live in dashboard/engine.js, the one file both this program and the page run.
import { createRequire } from 'node:module';
import { TIERS, farmPlan, kindTable } from './plans.ts';

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {}

const engine = createRequire(import.meta.url)('../dashboard/engine.js');

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;
const DERIVED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** No token of any kind is recorded for the protocol. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's own rule minus the floor: not versioned, not a wrapped, staked, bridged or exchange product. */
export function isOriginal(p: Protocol): boolean {
  return !VERSIONED.test(p.name) && !WRAPPED.test(p.name) && !EXCHANGE.test(p.name) && !DERIVED_CATEGORIES.has(p.category ?? '');
}

/** A live token with a usable market cap, of an original protocol: the comparables the value model learns from. */
export function isComparable(p: Protocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && isOriginal(p);
}

export function parseSnapshot(text: string): Snapshot {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new SnapshotError('snapshot.json lacks protocols or watchlist');
  if (typeof raw.as_of !== 'string' || typeof raw.floor_usd !== 'number') throw new SnapshotError('snapshot.json lacks as_of or floor_usd');
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const protocols: Protocol[] = raw.protocols.map((p: any, i: number) => {
    if (typeof p?.slug !== 'string' || typeof p.name !== 'string' || num(p.tvl_usd) === null) throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c: unknown) => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: raw.as_of, source: String(raw.source ?? ''), floor_usd: raw.floor_usd, protocols, watchlist: raw.watchlist.filter((s: unknown) => typeof s === 'string') };
}

const byValueThenSlug = (a: { implied: number; p: Protocol }, b: { implied: number; p: Protocol }): number => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1);

// Token odds, estimated from the snapshot itself: among original protocols of the same age band and TVL band, the share
// that already record a token. A proxy for how often a protocol of this age and size ends up with one, not a launch forecast.
const AGE_EDGES: Array<[number, string]> = [[180, 'under 6 months'], [365, '6 to 12 months'], [730, '1 to 2 years'], [Infinity, 'over 2 years']];
const TVL_EDGES: Array<[number, string]> = [[2e7, 'under $20M'], [1e8, '$20M to $100M'], [5e8, '$100M to $500M'], [Infinity, 'over $500M']];
const MIN_PEERS = 8;

function bands(p: Protocol, asOf: string): [string, string] {
  const age: number | null = engine.ageDays(asOf, p.listed_at);
  return [age === null ? 'age unknown' : AGE_EDGES.find(([top]) => age < top)![1], TVL_EDGES.find(([top]) => p.tvl_usd < top)![1]];
}

export function oddsTable(snapshot: Snapshot) {
  const cells = new Map<string, { n: number; tok: number }>();
  const bump = (key: string, tokened: boolean) => {
    const c = cells.get(key) ?? { n: 0, tok: 0 };
    c.n++;
    if (tokened) c.tok++;
    cells.set(key, c);
  };
  for (const p of snapshot.protocols) {
    if (!isOriginal(p) || p.tvl_usd <= 0) continue;
    const [a, t] = bands(p, snapshot.as_of), tokened = !isPreToken(p);
    bump(`${a}|${t}`, tokened);
    bump(`${a}|*`, tokened);
    bump('*|*', tokened);
  }
  return (p: Protocol) => {
    const [a, t] = bands(p, snapshot.as_of), self = isPreToken(p) ? 1 : 0;
    for (const [key, basis] of [[`${a}|${t}`, `${a}, TVL ${t}`], [`${a}|*`, `${a}, any TVL`], ['*|*', 'all original protocols']]) {
      const c = cells.get(key!);
      if (c && c.n - self >= MIN_PEERS) return { odds: c.tok / (c.n - self), n: c.n - self, basis: basis! };
    }
    return { odds: 0, n: 0, basis: 'no peers' };
  };
}

export function buildRadar(snapshot: Snapshot) {
  const onList = new Set(snapshot.watchlist);
  const train = snapshot.protocols.filter(isComparable);
  const fit = engine.fitValueModel(train, snapshot.as_of);
  const oddsOf = oddsTable(snapshot);
  const chosen = snapshot.protocols.filter((p) => onList.has(p.slug) || (isPreToken(p) && isOriginal(p)));
  const scored = chosen.map((p) => {
    const implied = engine.impliedValue(fit, p, snapshot.as_of), plan = farmPlan(p, snapshot.as_of), od = oddsOf(p);
    implied.value = Math.min(implied.value, 1e14);
    const net = engine.netValue(implied.value, p.tvl_usd, od.odds, { capital: plan.capital, gas_hi: plan.gas_hi, hold: plan.hold_days, hours: plan.hours });
    return { p, implied, plan, od, net };
  });
  scored.sort((a, b) => byValueThenSlug({ implied: a.implied.value, p: a.p }, { implied: b.implied.value, p: b.p }));
  // Neighbouring values cannot be told apart when they differ by less than the model's typical error (the median
  // cross-validated factor): the best and worst rank a row could hold if its value were off by that factor either way.
  const K: number = fit.cross_validated[fit.chosen].median_factor;
  const span = scored.map((s, i) => ({
    best: 1 + scored.filter((o, j) => j !== i && o.implied.value > s.implied.value * K).length,
    worst: 1 + scored.filter((o, j) => j !== i && o.implied.value * K > s.implied.value).length,
  }));
  const cents = (v: number): number => Math.round(v * 100) / 100;

  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    implied_value_usd: s.implied.value,
    implied_range_50_usd: [s.implied.lo50, s.implied.hi50],
    implied_range_80_usd: [s.implied.lo80, s.implied.hi80],
    rank_range_typical_error: [span[i]!.best, span[i]!.worst],
    token_status: 'no token recorded by DefiLlama',
    on_watchlist: onList.has(s.p.slug),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: engine.ageDays(snapshot.as_of, s.p.listed_at),
    token_odds: Math.round(s.od.odds * 1000) / 1000,
    token_odds_peers: s.od.n,
    expected_value_usd: cents(s.net.ev),
    cost_usd: cents(s.net.cost),
    verdict: s.net.verdict,
    plan_kind: s.plan.kind,
    capital_usd: s.plan.capital,
    gas_usd_range: [s.plan.gas_lo, s.plan.gas_hi],
    hold_days: s.plan.hold_days,
    hours: s.plan.hours,
    farm_steps: s.plan.steps.map((x) => x.text),
  }));

  const rows = scored.map((s, i) => ({
    r: i + 1,
    rr: [span[i]!.best, span[i]!.worst],
    slug: s.p.slug,
    name: s.p.name,
    cat: s.p.category,
    chains: s.p.chains,
    tvl: s.p.tvl_usd,
    g: s.p.change_7d,
    age: engine.ageDays(snapshot.as_of, s.p.listed_at),
    v: s.implied.value,
    lo: s.implied.lo50,
    hi: s.implied.hi50,
    lo80: s.implied.lo80,
    hi80: s.implied.hi80,
    wl: onList.has(s.p.slug),
    parts: s.implied.parts,
    odds: s.od.odds,
    on: s.od.n,
    ob: s.od.basis,
    ev: s.net.ev,
    cost: s.net.cost,
    gross: s.net.gross,
    slice: s.net.slice,
    vd: s.net.verdict,
    plan: { kind: s.plan.kind, chain: s.plan.chain, capital: s.plan.capital, gas_lo: s.plan.gas_lo, gas: s.plan.gas_hi, hold: s.plan.hold_days, hours: s.plan.hours, risk: s.plan.risk, steps: s.plan.steps.map((x) => ({ t: x.t, c: x.c, m: x.m })) },
  }));

  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({ slug: p.slug, name: p.name, cat: p.category, tvl: p.tvl_usd, g: p.change_7d, age: engine.ageDays(snapshot.as_of, p.listed_at), mcap: p.mcap_usd, sym: p.symbol, comp: isComparable(p) }));

  const placed = new Set([...board.map((r) => r.slug), ...live.map((r) => r.slug)]);
  const left = snapshot.protocols.filter((p) => !placed.has(p.slug));
  const train_rows = train.map((p) => ({ slug: p.slug, category: p.category, tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, mcap_usd: p.mcap_usd }));
  const radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      early: board.filter((r) => !r.on_watchlist).length,
      live: live.length,
      comparables: train.length,
      excluded: left.length,
      excluded_exchange: left.filter((p) => p.category === 'CEX').length,
    },
    rank_factor: K,
    assume: engine.ASSUME,
    kinds: kindTable(),
    tiers: TIERS.map(([top, cap]) => [Number.isFinite(top) ? top : null, cap]),
    odds_min_peers: MIN_PEERS,
    model: { ...fit, oof: fit.oof },
    rows,
    live,
    train: train_rows,
  };
  return { board, radar, fit };
}

/** The numbers a document may quote, as markdown lines, always computed from the fit and the board. */
export function notesBlock(fit: any, radar: any): string {
  const f = (x: number): string => x.toFixed(2), pick = fit.chosen, h = fit.held_out[pick], t = fit.time;
  const verdicts = ['farm', 'thin', 'skip'].map((v) => `${radar.rows.filter((r: any) => r.vd === v).length} ${v}`).join(', ');
  return [
    `- Chosen model: ${fit.labels.find((l: any) => l.id === pick).label} (ridge penalty ${fit.lambda}), picked by cross-validation on ${fit.n} live tokens.`,
    `- Hash-split held-out (${fit.hold.n_test} protocols): R2 ${f(h.r2)}, rank correlation ${f(h.spearman)}, median error x${h.median_factor.toFixed(1)}; the same procedure on the fit side picked ${fit.hold.pick.id}.`,
    `- Time-ordered test (fit on older listings, test on the newest ${t.n_test}): R2 ${f(t.chosen.r2)}, rank correlation ${f(t.chosen.spearman)}; 50% range held ${Math.round(t.cov50 * 100)}%, 80% range held ${Math.round(t.cov80 * 100)}%.`,
    `- Board: ${radar.counts.board} rows (${radar.counts.watchlist} on the watchlist), ${radar.counts.live} protocols that already trade, ${radar.counts.excluded} excluded; verdicts: ${verdicts}.`,
  ].join('\n');
}

/** Why the board is not one the gate takes, or null. */
export function boardIssue(board: any[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i];
    if (r.rank !== i + 1) return `rank ${i + 1} is ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1].implied_value_usd) return `row ${i + 1} outranks row ${i}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  if (board[0].implied_value_usd === board[board.length - 1].implied_value_usd) return 'every row shares one implied value';
  return null;
}

export function dataScript(radar: unknown): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
