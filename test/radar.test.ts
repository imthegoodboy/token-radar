// Tests: `node --test test/radar.test.ts` (Node 22.18+). They build a synthetic snapshot, so no kit file is needed, and check the
// gate's rules (board shape, ranks, watchlist coverage, farm steps, dossier bytes, no network addresses) by running main.ts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, isComparable, isOriginal, notesBlock, oddsTable, parseSnapshot } from '../lib/model.ts';
import { farmPlan } from '../lib/plans.ts';
import { buildDossier } from '../vendor/makefun-board.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const engine = createRequire(import.meta.url)('../dashboard/engine.js');

/** A small deterministic universe: live tokens whose cap follows TVL^0.5 with noise, plus pre-token protocols. */
function synthetic(): any {
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cats = ['Lending', 'Dexs', 'Yield', 'RWA', 'Derivatives', 'Risk Curators', 'CDP'];
  const protocols: any[] = [];
  for (let i = 0; i < 260; i++) {
    const tvl = Math.floor(10 ** (6.7 + rnd() * 2.3));
    const live = i % 2 === 0;
    protocols.push({
      slug: `p${String(i).padStart(3, '0')}`,
      name: `Proto ${String.fromCharCode(65 + (i % 26))}${i}`,
      category: cats[i % cats.length],
      chains: i % 5 === 0 ? [] : ['Ethereum', 'Base'].slice(0, 1 + (i % 2)),
      tvl_usd: tvl,
      change_7d: i % 11 === 0 ? null : Math.round((rnd() * 60 - 25) * 1e4) / 1e4,
      mcap_usd: live ? Math.floor(Math.sqrt(tvl) * 400 * 10 ** (rnd() - 0.5)) : null,
      listed_at: i % 7 === 0 ? null : `202${2 + (i % 4)}-0${1 + (i % 9)}-1${i % 9}`,
      gecko_id: live ? `g${i}` : null,
      symbol: live ? `S${i}` : null,
    });
  }
  const watchlist = protocols.filter((p) => p.mcap_usd === null && p.tvl_usd >= 5e7).map((p) => p.slug);
  return { as_of: '2026-11-14', source: 'synthetic', floor_usd: 50_000_000, protocols, watchlist };
}

test('the model is deterministic and recovers a planted elasticity', () => {
  const snap = parseSnapshot(JSON.stringify(synthetic()));
  const a = buildRadar(snap), b = buildRadar(snap);
  assert.equal(JSON.stringify(a.board), JSON.stringify(b.board));
  const elasticity = a.fit.terms.find((t: any) => t.id === 'tvl');
  assert.ok(elasticity.value > 0.3 && elasticity.value < 0.7, `elasticity ${elasticity.value}`);
  assert.ok(a.fit.held_out[a.fit.chosen].r2 > 0.3, 'planted signal should be found out of sample');
});

test('the board satisfies the gate', () => {
  const snap = parseSnapshot(JSON.stringify(synthetic()));
  const { board } = buildRadar(snap);
  assert.equal(boardIssue(board, snap), null);
  const slugs = new Set(board.map((r: any) => r.slug));
  for (const s of snap.watchlist) assert.ok(slugs.has(s), `watchlist slug ${s} missing`);
  assert.equal(new Set(board.map((r: any) => r.rank)).size, board.length);
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  for (const r of board) {
    assert.ok(bySlug.has(r.slug));
    assert.equal(bySlug.get(r.slug)!.mcap_usd === null || snap.watchlist.includes(r.slug), true, 'a live token must not be ranked');
  }
});

test('live-token and derived products stay off the board', () => {
  const p = (over: object) => ({ slug: 'x', name: 'X', category: 'Dexs', chains: [], tvl_usd: 1e7, change_7d: 0, mcap_usd: null, listed_at: null, gecko_id: null, symbol: null, ...over });
  assert.equal(isOriginal(p({ name: 'Foo V2' })), false);
  assert.equal(isOriginal(p({ name: 'Wrapped Foo' })), false);
  assert.equal(isOriginal(p({ category: 'Liquid Staking' })), false);
  assert.equal(isOriginal(p({ name: 'Binance Foo' })), false);
  assert.equal(isOriginal(p({})), true);
  assert.equal(isComparable(p({ mcap_usd: 0 })), false);
  assert.equal(isComparable(p({ mcap_usd: 5e6 })), true);
});

test('farm plans stay inside the gate for odd inputs', () => {
  const base = { slug: 'z', name: 'Z', category: null, chains: [], tvl_usd: 5e6, change_7d: null, mcap_usd: null, listed_at: null, gecko_id: null, symbol: null };
  const odd = [base, { ...base, category: 'Prediction Market', chains: ['Ethereum'], change_7d: -80, listed_at: '2026-11-13' }, { ...base, category: 'Cross Chain Bridge', chains: ['Solana'], change_7d: 4448, listed_at: '2021-10-20' }];
  for (const p of odd) {
    const plan = farmPlan(p, '2026-11-14');
    assert.ok(plan.steps.length >= 3 && plan.steps.length <= 12);
    for (const s of plan.steps) assert.ok(s.text.length >= 20 && s.text.length <= 600 && /Cost: .+ Time: .+\.$/.test(s.text), s.text);
  }
});

test('plans differ by category, capital follows the TVL tier, wording stays ordinary', () => {
  const base = { slug: 'z', name: 'Z', category: 'Lending', chains: ['Base'], tvl_usd: 5e6, change_7d: 1, mcap_usd: null, listed_at: '2025-01-01', gecko_id: null, symbol: null };
  const lend = farmPlan(base, '2026-11-14'), perp = farmPlan({ ...base, category: 'Derivatives' }, '2026-11-14'), big = farmPlan({ ...base, tvl_usd: 9e8 }, '2026-11-14');
  assert.notEqual(lend.kind, perp.kind);
  assert.notDeepEqual(lend.steps.map((s) => s.t), perp.steps.map((s) => s.t));
  assert.notEqual(lend.risk, perp.risk);
  assert.ok(big.capital > lend.capital, 'capital rises with the TVL tier');
  assert.ok(lend.gas_lo < lend.gas_hi, 'gas is a range');
  for (const s of [...lend.steps, ...perp.steps]) assert.ok(!/look more like|several wallets|many wallets|multiple wallets|\$6\b/i.test(s.t), s.t);
});

test('model choice, time-ordered test, coverage, odds, verdicts and rank ranges are present and consistent', () => {
  const snap = parseSnapshot(JSON.stringify(synthetic()));
  const { board, radar, fit } = buildRadar(snap);
  assert.ok(fit.labels.some((l: any) => l.id === fit.chosen));
  assert.ok(fit.select.length === fit.labels.length && fit.held_out[fit.chosen] && fit.time.chosen && fit.time.n_test > 0);
  assert.ok(fit.time.n_fit + fit.time.n_test === fit.n && fit.hold.n_fit + fit.hold.n_test === fit.n);
  for (const c of [fit.hold.cov50, fit.hold.cov80, fit.time.cov50, fit.time.cov80]) assert.ok(c >= 0 && c <= 1);
  assert.ok(fit.terms.filter((t: any) => !t.used).every((t: any) => t.value === 1 || t.id === 'tvl'));
  assert.ok(radar.rank_factor >= 1);
  for (const r of board) {
    assert.ok(r.token_odds >= 0 && r.token_odds <= 1 && r.token_odds_peers >= 0);
    assert.ok(['farm', 'thin', 'skip'].includes(r.verdict));
    assert.ok(r.rank_range_typical_error[0] <= r.rank && r.rank <= r.rank_range_typical_error[1]);
    assert.ok(r.expected_value_usd >= 0 && r.cost_usd > 0);
  }
  // The formula is explicit: expected value = value x share x slice x odds; the verdict compares it with the cost.
  const plan = { capital: 500, gas_hi: 4, hold: 30, hours: 2 }, a = engine.ASSUME;
  const n = engine.netValue(1e7, 1e8, 0.5, plan);
  assert.ok(Math.abs(n.ev - 1e7 * a.share * Math.min(1, (500 * a.active) / 1e8) * 0.5) < 1e-6);
  assert.ok(Math.abs(n.cost - (500 * a.rate * 30 / 365 + 4 + 2 * a.hour)) < 1e-9);
  assert.equal(engine.netValue(1e10, 1e6, 1, plan).verdict, 'farm');
  assert.equal(engine.netValue(1, 1e9, 0, plan).verdict, 'skip');
  assert.ok(notesBlock(fit, radar).includes(`R2 ${fit.held_out[fit.chosen].r2.toFixed(2)}`));
});

test('--notes rewrites only the block between the markers with the computed numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-notes-'));
  const input = join(dir, 'snapshot.json'), notes = join(dir, 'NOTES.md');
  writeFileSync(input, JSON.stringify(synthetic()));
  writeFileSync(notes, 'before\n<!-- results -->\nstale 0.15\n<!-- /results -->\nafter\n');
  execFileSync(process.execPath, ['main.ts', '--input', input, '--output', join(dir, 'out'), '--notes', notes], { cwd: root, stdio: 'pipe' });
  const text = readFileSync(notes, 'utf8');
  assert.ok(text.startsWith('before\n') && text.endsWith('after\n') && !text.includes('stale'));
  const board = JSON.parse(readFileSync(join(dir, 'out', 'board.json'), 'utf8'));
  assert.ok(text.includes(`R2 ${board.model.held_out.r2.toFixed(2)}`) && text.includes(`${board.rows.length} rows`));
});

test('odds come from peers of the same bands, and widen when a cell is thin', () => {
  const snap = parseSnapshot(JSON.stringify(synthetic()));
  const of = oddsTable(snap), pre = snap.protocols.find((p) => p.mcap_usd === null)!, o = of(pre);
  assert.ok(o.n >= 8 && o.odds > 0 && o.odds < 1 && o.basis.length > 0);
  const lone = { ...pre, tvl_usd: 9e12, listed_at: '2026-11-13' };
  assert.ok(of(lone).n === 0 || of(lone).n >= 8);
});

test('implied value rises with TVL when nothing else changes', () => {
  const snap = parseSnapshot(JSON.stringify(synthetic()));
  const { fit } = buildRadar(snap);
  const p = { tvl_usd: 2e7, change_7d: 5, listed_at: '2024-01-01', category: 'Lending' };
  const lo = engine.impliedValue(fit, p, snap.as_of).value, hi = engine.impliedValue(fit, { ...p, tvl_usd: 2e9 }, snap.as_of).value;
  assert.ok(hi > lo);
});

test('main.ts writes bytes the gate accepts, the same twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-'));
  const input = join(dir, 'snapshot.json');
  writeFileSync(input, JSON.stringify(synthetic()));
  const run = (name: string) => {
    const out = join(dir, name);
    execFileSync(process.execPath, ['main.ts', '--input', input, '--output', out], { cwd: root, stdio: 'pipe' });
    return out;
  };
  const a = run('a'), b = run('b');
  for (const f of ['board.json', 'data.js', 'dossier.json']) assert.ok(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), `${f} differs between runs`);
  // The dossier is exactly what the library writes from the output.
  const caps = { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } };
  assert.ok(Buffer.from(buildDossier(a, caps)).equals(readFileSync(join(a, 'dossier.json'))));
  assert.ok(readFileSync(join(a, 'dossier.json')).length <= 1.5 * 1024 * 1024);
  // The dashboard names no network address in an attribute, a stylesheet or a script import.
  const dash = join(a, 'dashboard');
  const names = readdirSync(dash);
  assert.ok(names.includes('index.html') && names.some((n) => n.endsWith('.css')) && names.some((n) => n.endsWith('.js')));
  for (const n of names) {
    const text = readFileSync(join(dash, n), 'utf8');
    if (n.endsWith('.html')) assert.ok(!/(?:href|src|action|content)\s*=\s*["']https?:\/\//i.test(text), `${n} has a network attribute`);
    if (n.endsWith('.css')) assert.ok(!/https?:\/\//i.test(text), `${n} names a network address`);
    if (n.endsWith('.js')) assert.ok(!/(?:import|export|require)\b[^;\n]*["']https?:\/\//.test(text), `${n} imports a network address`);
  }
  // The dossier's source text fits whole, so the judge reads every file.
  const dossier = JSON.parse(readFileSync(join(a, 'dossier.json'), 'utf8'));
  assert.ok(Buffer.byteLength(dossier.text) <= 65_536 && !/not shown/.test(dossier.text), 'dashboard source is cut in the dossier');
});
