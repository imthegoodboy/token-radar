// Board assembly for the token radar: snapshot in, ranked board and dashboard data out.
// The value model and the farm plans live in dashboard/engine.js, the one file both this program and the page run.
import { createRequire } from 'node:module';

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

export function buildRadar(snapshot: Snapshot) {
  const onList = new Set(snapshot.watchlist);
  const train = snapshot.protocols.filter(isComparable);
  const fit = engine.fitValueModel(train, snapshot.as_of);
  const chosen = snapshot.protocols.filter((p) => onList.has(p.slug) || (isPreToken(p) && isOriginal(p)));
  const scored = chosen.map((p) => ({ p, implied: engine.impliedValue(fit, p, snapshot.as_of), plan: engine.farmPlan(p, { asOf: snapshot.as_of }) }));
  scored.forEach((s) => (s.implied.value = Math.min(s.implied.value, 1e14)));
  scored.sort((a, b) => byValueThenSlug({ implied: a.implied.value, p: a.p }, { implied: b.implied.value, p: b.p }));

  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    implied_value_usd: s.implied.value,
    implied_range_50_usd: [s.implied.lo50, s.implied.hi50],
    implied_range_80_usd: [s.implied.lo80, s.implied.hi80],
    token_status: 'no token recorded by DefiLlama',
    on_watchlist: onList.has(s.p.slug),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: engine.ageDays(snapshot.as_of, s.p.listed_at),
    plan_kind: s.plan.kind,
    capital_usd: s.plan.capital,
    gas_usd: s.plan.gas,
    hold_days: s.plan.hold_days,
    farm_steps: s.plan.steps.map((x: { text: string }) => x.text),
  }));

  const rows = scored.map((s, i) => ({
    r: i + 1,
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
    plan: { kind: s.plan.kind, capital: s.plan.capital, gas: s.plan.gas, hold: s.plan.hold_days, hours: s.plan.hours, steps: s.plan.steps.map((x: { t: string; c: string; m: string }) => ({ t: x.t, c: x.c, m: x.m })) },
  }));

  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({ slug: p.slug, name: p.name, cat: p.category, tvl: p.tvl_usd, g: p.change_7d, age: engine.ageDays(snapshot.as_of, p.listed_at), mcap: p.mcap_usd, sym: p.symbol, comp: isComparable(p) }));

  const train_rows = train.map((p) => ({ slug: p.slug, category: p.category, tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, mcap_usd: p.mcap_usd }));
  const radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    counts: { protocols: snapshot.protocols.length, watchlist: snapshot.watchlist.length, board: board.length, early: board.filter((r) => !r.on_watchlist).length, live: live.length, comparables: train.length },
    model: { ...fit, oof: fit.oof },
    rows,
    live,
    train: train_rows,
  };
  return { board, radar, fit };
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
