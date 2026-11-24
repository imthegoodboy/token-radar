// Token Radar page. Reads window.RADAR (data.js, written by main.ts beside this folder) and window.RadarEngine
// (engine.js, the same file main.ts runs). Board: renderBoard, renderDetail. Already trading: renderLive.
// Model: renderModel, refit. Cover strips: renderCover. Farm plans are built in lib/plans.ts and arrive in data.js.
(() => {
  'use strict';
  const D = window.RADAR, E = window.RadarEngine;
  if (!D || !E) { document.body.textContent = 'data.js did not load: run main.ts and open output/dashboard/index.html.'; return; }
  const M = D.model, A = E.ASSUME;
  const $ = (s) => document.querySelector(s);
  const oofBySlug = new Map(M.oof.map((o) => [o.slug, o]));
  const rowBySlug = new Map(D.rows.map((r) => [r.slug, r]));

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
    return n;
  }
  // The namespace id below is an XML name, never fetched.
  const svg = (tag, attrs, ...kids) => {
    const n = document.createElementNS('http' + '://www.w3.org/2000/svg', tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    n.append(...kids);
    return n;
  };

  const usd = (n) => n === null || n === undefined || !isFinite(n) ? 'n/a' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : n >= 10 ? '$' + Math.round(n) : '$' + n.toFixed(2);
  const pct = (n) => n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const age = (d) => d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d';
  const mult = (x) => '×' + (x >= 10 ? x.toFixed(0) : x.toFixed(2));
  const lines = (p, n) => p.chains.length <= n ? p.chains.join(', ') : p.chains.slice(0, n).join(', ') + ' +' + (p.chains.length - n);
  const f2 = (x) => x.toFixed(2);
  const p0 = (x) => Math.round(x * 100) + '%';
  const gasText = (p) => '$' + p.gas_lo.toFixed(2) + ' to $' + p.gas.toFixed(2);
  const label = (id) => M.labels.find((l) => l.id === id).label;

  // ---- state in the address hash, so every view can be linked --------------------------------------------
  const state = { v: 'board', q: '', cat: 'all', chain: 'all', scope: 'all', vd: 'all', sort: 'r', dir: 1, p: '', lsort: 'mcap', ldir: -1, lq: '' };
  const KEYS = ['v', 'q', 'cat', 'chain', 'scope', 'vd', 'sort', 'p', 'lsort', 'lq'];
  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    KEYS.forEach((k) => { if (params.has(k)) state[k] = params.get(k); });
    if (params.has('dir')) state.dir = params.get('dir') === 'desc' ? -1 : 1;
  }
  function writeHash() {
    const params = new URLSearchParams();
    KEYS.forEach((k) => { if (state[k] && state[k] !== 'all' && !(k === 'v' && state.v === 'board') && !(k === 'sort' && state.sort === 'r') && !(k === 'lsort' && state.lsort === 'mcap')) params.set(k, state[k]); });
    if (state.sort !== 'r' || state.dir !== 1) params.set('dir', state.dir < 0 ? 'desc' : 'asc');
    history.replaceState(null, '', params.toString() ? '#' + params : location.pathname + location.search);
  }

  // ---- one sortable table builder for both lists (on narrow screens the rows become cards) ----------------
  function table(caption, cols, rows, sortKey, dir, onSort, onPick, selected) {
    const head = h('tr', null, cols.map((c) => h('th', { scope: 'col', class: c.cls, 'aria-sort': c.k === sortKey ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
      h('button', { type: 'button', class: 'sort', onclick: () => onSort(c.k, c.k === sortKey ? -dir : c.first || 1) }, c.label, h('span', { 'aria-hidden': 'true', class: 'caret', text: c.k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '' })))));
    const body = rows.map((r) => h('tr', { class: selected && r.slug === selected ? 'sel' : '', onclick: onPick ? () => onPick(r.slug) : null }, cols.map((c) => h('td', { class: c.cls, 'data-label': c.label }, c.cell(r)))));
    return h('table', null, h('caption', { class: 'sr', text: caption }), h('thead', null, head), h('tbody', null, body));
  }
  function sorted(rows, cols, key, dir, extra) {
    const c = cols.find((x) => x.k === key) || (extra || {})[key] || cols[0];
    return rows.slice().sort((a, b) => {
      const x = c.val(a), y = c.val(b);
      const nx = x === null || x === undefined, ny = y === null || y === undefined;
      if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.slug < b.slug ? -1 : 1);
    });
  }

  // ---- board ----------------------------------------------------------------------------------------------
  const verdictTag = (r) => h('span', { class: 'tag v-' + r.vd, text: r.vd });
  const boardCols = [
    { k: 'r', label: 'Rank', cls: 'num', val: (r) => r.r, cell: (r) => [h('strong', { text: String(r.r) }), h('span', { class: 'sub', title: 'Best and worst rank if its value were off by the typical error (×' + D.rank_factor.toFixed(1) + ') either way', text: 'ranks ' + r.rr[0] + '-' + r.rr[1] })] },
    { k: 'name', label: 'Protocol', first: 1, val: (r) => r.name.toLowerCase(), cell: (r) => h('div', { class: 'who' }, h('div', { class: 'nm' }, h('button', { type: 'button', class: 'pick', onclick: (e) => { e.stopPropagation(); open(r.slug); }, 'aria-label': 'Open detail for ' + r.name, text: r.name }), r.wl ? h('span', { class: 'tag', text: 'watchlist' }) : null), h('span', { class: 'sub', text: (r.cat || 'No category') + ' · ' + lines(r, 2) })) },
    { k: 'v', label: 'Implied value', cls: 'num', first: -1, val: (r) => r.v, cell: (r) => [h('strong', { text: usd(r.v) }), h('span', { class: 'sub', text: usd(r.lo) + ' to ' + usd(r.hi) })] },
    { k: 'odds', label: 'Odds', cls: 'num', first: -1, val: (r) => r.odds, cell: (r) => [h('span', { text: p0(r.odds) }), h('span', { class: 'sub', text: 'of ' + r.on + ' peers' })] },
    { k: 'ev', label: 'Expected value', cls: 'num', first: -1, val: (r) => r.ev, cell: (r) => [h('strong', { text: usd(r.ev) }), h('span', { class: 'sub' }, verdictTag(r), ' cost ' + usd(r.cost))] },
    { k: 'tvl', label: 'TVL, 7d', cls: 'num', first: -1, val: (r) => r.tvl, cell: (r) => [usd(r.tvl), h('span', { class: 'sub ' + (r.g > 0 ? 'up' : r.g < 0 ? 'down' : ''), text: pct(r.g) })] },
    { k: 'age', label: 'No token for', cls: 'num', first: -1, val: (r) => r.age, cell: (r) => age(r.age) },
    { k: 'capital', label: 'Capital, hold', cls: 'num', first: 1, val: (r) => r.plan.capital, cell: (r) => [usd(r.plan.capital), h('span', { class: 'sub', text: r.plan.hold + ' d, ' + r.plan.hours + ' h' })] }
  ];
  const extraSorts = { g: { val: (r) => r.g } };
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return D.rows.filter((r) => (state.cat === 'all' || (r.cat || 'No category') === state.cat) && (state.chain === 'all' || r.chains.includes(state.chain)) && (state.vd === 'all' || r.vd === state.vd) &&
      (state.scope === 'all' || (state.scope === 'wl') === r.wl) && (!q || (r.name + ' ' + r.slug + ' ' + (r.cat || '') + ' ' + r.chains.join(' ')).toLowerCase().includes(q)));
  }
  function renderBoard() {
    const rows = sorted(filtered(), boardCols, state.sort, state.dir, extraSorts);
    $('#count').textContent = rows.length + ' of ' + D.rows.length + ' protocols' + (rows.length ? '' : ': nothing matches, clear a filter');
    $('#board-table').replaceChildren(table('Pre-token protocols ranked by implied value', boardCols, rows, state.sort, state.dir, (k, d) => { state.sort = k; state.dir = d; sync(); }, open, state.p));
    $('#reset').hidden = ![state.q, state.cat !== 'all', state.chain !== 'all', state.scope !== 'all', state.vd !== 'all'].some(Boolean);
  }

  function stat(lbl, value, note) { return h('div', { class: 'stat' }, h('span', { class: 'k', text: lbl }), h('strong', { text: value }), note ? h('span', { class: 'sub', text: note }) : null); }

  // ---- cover: KPI strip and a self-check strip, every figure computed here from data.js ------------------
  function renderCover() {
    const C = D.counts, count = (v) => D.rows.filter((r) => r.vd === v).length, slugs = new Set([...D.rows, ...D.live].map((r) => r.slug));
    const have = new Set(D.rows.map((r) => r.slug)), wl = D.rows.filter((r) => r.wl).length;
    const checks = [
      ['Watchlist covered', wl === C.watchlist, wl + ' of ' + C.watchlist],
      ['Every protocol in one bucket', slugs.size === D.rows.length + D.live.length && D.rows.length + D.live.length + C.excluded === C.protocols, D.rows.length + ' ranked + ' + D.live.length + ' trading + ' + C.excluded + ' excluded = ' + C.protocols],
      ['Ranks 1 to N, never rising', D.rows.every((r, i) => r.r === i + 1 && (!i || r.v <= D.rows[i - 1].v)), D.rows.length + ' rows'],
      ['Plans with 8 costed steps', D.rows.every((r) => r.plan.steps.length === 8 && r.plan.steps.every((s) => s.c && s.m)), D.rows.length + ' plans'],
      ['Unique slugs', have.size === D.rows.length, have.size + ' distinct']
    ];
    $('#kpi').replaceChildren(stat('Watchlist covered', wl + ' of ' + C.watchlist), stat('Protocols accounted for', C.protocols + ' of ' + C.protocols, D.rows.length + ' ranked + ' + D.live.length + ' trading + ' + C.excluded + ' excluded'), stat('Ranked', String(D.rows.length), C.early + ' beyond the watchlist'), stat('Traded comparables', String(C.comparables), 'the model learns from these'), stat('Verdicts', count('farm') + ' / ' + count('thin') + ' / ' + count('skip'), 'farm / thin / skip, on assumptions'));
    $('#checks').replaceChildren(h('strong', { text: 'Self-check, computed in this page: ' }), ...checks.map((c) => h('span', { class: 'chk ' + (c[1] ? 'ok' : 'bad'), title: c[2] }, (c[1] ? '✓ ' : '✗ ') + c[0])));
  }

  function renderIdle() {
    const t = M.held_out[M.chosen];
    return [
      h('h2', { text: 'How to read this board' }),
      h('p', null, 'Every row is a protocol DefiLlama records no token for. Its ', h('strong', { text: 'implied value' }), ' is the market cap a token typically has among ' + M.n + ' protocols that already trade, from the model chosen by cross-validation (' + label(M.chosen) + '). ', h('strong', { text: 'Odds' }), ' is the share of same-age, same-size peers that already have a token. ', h('strong', { text: 'Expected value' }), ' multiplies value, an assumed airdrop share, your slice and the odds; the verdict compares it with the cost of capital, gas and time. Those inputs are assumptions, listed on the Model tab.'),
      h('div', { class: 'stats' }, stat('Held-out median error', '×' + t.median_factor.toFixed(1), 'on ' + M.hold.n_test + ' protocols the fit never saw'), stat('Held-out R²', f2(t.r2), 'little of the spread is explained'), stat('Rank correlation', f2(t.spearman), 'held-out, estimate against actual')),
      h('p', { class: 'warn', text: 'Neighbouring values overlap within the typical error (×' + D.rank_factor.toFixed(1) + '): the rank column shows how far each row could move. Read the board as tiers, not an exact order. The model ranks protocols by what comparable tokens are worth; it does not predict whether or when a token launches.' }),
      h('p', null, 'Select a row for its value breakdown, verdict and costed farm plan.')
    ];
  }

  function bar(r) {
    const lo = Math.log10(r.lo80), hi = Math.log10(r.hi80), at = (v) => 8 + ((Math.log10(v) - lo) / (hi - lo)) * 304;
    return svg('svg', { viewBox: '0 0 320 54', class: 'range', role: 'img', 'aria-label': 'Implied value ' + usd(r.v) + ', 50% range ' + usd(r.lo) + ' to ' + usd(r.hi) + ', 80% range ' + usd(r.lo80) + ' to ' + usd(r.hi80) },
      svg('line', { x1: 8, x2: 312, y1: 26, y2: 26, class: 'r80' }), svg('line', { x1: at(r.lo), x2: at(r.hi), y1: 26, y2: 26, class: 'r50' }), svg('circle', { cx: at(r.v), cy: 26, r: 6, class: 'dot' }),
      svg('text', { x: 8, y: 49, class: 'axis' }, usd(r.lo80)), svg('text', { x: 312, y: 49, class: 'axis', 'text-anchor': 'end' }, usd(r.hi80)), svg('text', { x: at(r.v), y: 12, class: 'axis', 'text-anchor': 'middle' }, usd(r.v)));
  }
  const chips = (list) => h('ul', { class: 'eq' }, list.map((w) => h('li', { class: w[2] || '', title: w[3] || '' }, h('span', { text: w[0] }), h('strong', { text: w[1] }))));
  const listedFrom = (days) => new Date(Date.parse(D.as_of + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);

  function renderDetail(r) {
    const p = r.parts, pl = r.plan, base = Math.pow(10, M.intercept) * 1e7, f = (x) => Math.pow(10, x), used = (i) => M.cols.includes(i);
    const net = E.netValue(r.v, r.tvl, r.odds, { capital: pl.capital, gas_hi: pl.gas, hold: pl.hold, hours: pl.hours });
    const why = [
      ['Starting point', 'a $10M protocol' + (used(2) ? ', about 1,000 days old' : ''), usd(base)],
      ['TVL ' + usd(r.tvl), 'exponent ' + M.w[0].toFixed(2) + ' on TVL', mult(f(p.tvl))],
      used(1) ? ['7-day growth ' + pct(r.g), r.g !== null && (r.g > 100 || r.g < -50) ? 'capped to the -50% to +100% range' : 'fitted per-point effect', mult(f(p.growth))] : null,
      used(2) ? ['No token for ' + age(r.age), r.age === null ? 'age unknown: its own fitted factor' : 'fitted effect of log age', mult(f(p.age))] : null,
      used(4) ? ['Category ' + (r.cat || 'none'), 'fitted group factor', mult(f(p.group))] : null
    ].filter(Boolean);
    return [
      h('div', { class: 'dhead' }, h('div', null, h('h2', { id: 'dname', text: r.name }), h('p', { class: 'sub', text: '#' + r.r + ' of ' + D.rows.length + ' · ' + (r.cat || 'No category') + ' · ' + lines(r, 4) + ' · defillama.com/protocol/' + r.slug })), h('button', { type: 'button', class: 'close', onclick: () => open(''), 'aria-label': 'Close detail' }, '×')),
      h('p', { class: 'tags' }, verdictTag(r), h('span', { class: 'tag', text: r.wl ? 'on the watchlist' : 'beyond the watchlist' }), h('span', { class: 'tag', text: 'no token recorded' })),
      h('div', { class: 'valuebox' }, h('div', null, h('span', { class: 'k', text: 'Implied value' }), h('strong', { class: 'big', text: usd(r.v) }), h('span', { class: 'sub', text: 'typical market cap of a comparable live token; rank ' + r.r + ', anywhere from ' + r.rr[0] + ' to ' + r.rr[1] + ' if its value is off by the typical error (×' + D.rank_factor.toFixed(1) + ')' })), bar(r)),
      h('h3', { text: 'Net verdict: ' + r.vd + ' (assumptions, not facts)' }),
      h('table', { class: 'vt' }, h('tbody', null, [['Implied value', usd(r.v)], ['× airdrop share (assumed)', p0(A.share)], ['× your slice (assumed): capital × ' + A.active + ' ÷ TVL', (net.slice * 100).toFixed(4) + '%'], ['× odds (' + r.on + ' peers, ' + r.ob + ')', p0(r.odds)], ['= expected value', usd(net.ev), 1],
        ['Cost: capital ' + usd(pl.capital * A.rate * pl.hold / 365) + ' (' + usd(pl.capital) + ' × ' + p0(A.rate) + ' a year × ' + pl.hold + ' d) + gas, high end ' + usd(pl.gas) + ' + effort ' + usd(pl.hours * A.hour) + ' (' + pl.hours + ' h × $' + A.hour + ')', usd(net.cost), 1]].map((w) => h('tr', { class: w[2] ? 'tot' : '' }, h('th', { scope: 'row', text: w[0] }), h('td', { class: 'num', text: w[1] }))))),
      h('p', { class: 'sub', text: 'Farm: expected value ≥ ' + A.farm + '× cost; thin: ≥ ' + A.thin + '×; else skip. Odds is a peer share, not a forecast.' }),
      h('h3', { text: 'Why the implied value (each factor fitted on live tokens)' }),
      h('ul', { class: 'eq', 'aria-label': 'How the implied value is built' }, why.map((w) => h('li', { title: w[1] }, h('span', { text: w[0] }), h('strong', { text: w[2] }))), h('li', { class: 'total' }, h('span', { text: '= recomputed here' }), h('strong', { text: usd(E.impliedValue(M, { tvl_usd: r.tvl, change_7d: r.g, listed_at: r.age === null ? null : listedFrom(r.age), category: r.cat }, D.as_of).value) }))),
      h('h3', { text: 'Farm plan: ' + (D.kinds.find((k) => k.kind === pl.kind) || {}).label }),
      h('p', { class: 'planline', title: 'Capital follows the TVL tier; gas is an assumed fee range on ' + pl.chain + '; main risk: ' + pl.risk }, 'Capital ' + usd(pl.capital) + ' · gas ' + gasText(pl) + ' · hold ' + pl.hold + ' d · time ~' + pl.hours + ' h'),
      h('ol', { class: 'plan' }, pl.steps.map((s) => h('li', null, h('span', { text: s.t }), h('span', { class: 'cm' }, h('b', { text: 'Cost ' }), s.c, h('b', { text: '  Time ' }), s.m)))),
    ];
  }

  function open(slug) {
    state.p = state.p === slug && slug ? '' : slug;
    if (slug && !rowBySlug.has(slug)) state.p = '';
    sync();
    if (state.p) $('#detail').focus();
  }
  function renderPanel() {
    const panel = $('#detail'), r = rowBySlug.get(state.p);
    panel.classList.toggle('open', !!r);
    panel.setAttribute('aria-label', r ? 'Detail for ' + r.name : 'How to read the board');
    panel.replaceChildren(...(r ? renderDetail(r) : renderIdle()));
  }

  // ---- already trading ---------------------------------------------------------------------------------------
  const liveCols = [
    { k: 'name', label: 'Protocol', first: 1, val: (r) => r.name.toLowerCase(), cell: (r) => h('div', { class: 'who' }, h('strong', { text: r.name }), h('span', { class: 'sub', text: (r.cat || 'No category') + (r.sym ? ' · ' + r.sym : '') })) },
    { k: 'mcap', label: 'Market cap', cls: 'num', first: -1, val: (r) => r.mcap, cell: (r) => r.mcap ? usd(r.mcap) : 'none recorded' },
    { k: 'tvl', label: 'TVL', cls: 'num', first: -1, val: (r) => r.tvl, cell: (r) => usd(r.tvl) },
    { k: 'ratio', label: 'Cap / TVL', cls: 'num', first: -1, val: (r) => r.mcap ? r.mcap / r.tvl : null, cell: (r) => r.mcap ? (r.mcap / r.tvl).toFixed(2) : 'n/a' },
    { k: 'model', label: 'Model, out of fold', cls: 'num', first: -1, val: (r) => (oofBySlug.get(r.slug) || {}).predicted, cell: (r) => oofBySlug.has(r.slug) ? usd(oofBySlug.get(r.slug).predicted) : h('span', { class: 'sub', text: r.comp ? 'n/a' : 'not a comparable' }) },
    { k: 'err', label: 'Off by', cls: 'num', first: -1, val: (r) => { const o = oofBySlug.get(r.slug); return o ? Math.abs(Math.log10(o.actual / o.predicted)) : null; }, cell: (r) => { const o = oofBySlug.get(r.slug); return o ? '×' + Math.pow(10, Math.abs(Math.log10(o.actual / o.predicted))).toFixed(1) + (o.actual > o.predicted ? ' under' : ' over') : ''; } }
  ];
  function renderLive() {
    const q = state.lq.trim().toLowerCase();
    const rows = sorted(D.live.filter((r) => !q || (r.name + ' ' + r.slug + ' ' + (r.sym || '')).toLowerCase().includes(q)), liveCols, state.lsort, state.ldir);
    $('#lcount').textContent = rows.length + ' of ' + D.live.length + ' protocols that record a token';
    $('#live-table').replaceChildren(table('Protocols that already trade', liveCols, rows, state.lsort, state.ldir, (k, d) => { state.lsort = k; state.ldir = d; sync(); }, null, ''));
  }

  // ---- model ------------------------------------------------------------------------------------------------
  function scatter() {
    const W = 480, H = 330, P = 62, pts = M.oof.filter((o) => o.actual > 0);
    const lo = Math.floor(Math.log10(Math.min(...pts.map((o) => Math.min(o.actual, o.predicted))))), hi = Math.ceil(Math.log10(Math.max(...pts.map((o) => Math.max(o.actual, o.predicted)))));
    const sx = (v) => P + ((Math.log10(v) - lo) / (hi - lo)) * (W - P - 12), sy = (v) => H - P - ((Math.log10(v) - lo) / (hi - lo)) * (H - P - 12);
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'scatter', role: 'img', 'aria-label': 'Scatter of out-of-fold predicted against actual market cap for ' + pts.length + ' live tokens; points follow the diagonal loosely' });
    for (let e = lo; e <= hi; e++) s.append(svg('line', { x1: P, x2: W - 12, y1: sy(Math.pow(10, e)), y2: sy(Math.pow(10, e)), class: 'grid' }), svg('text', { x: P - 6, y: sy(Math.pow(10, e)) + 4, class: 'axis', 'text-anchor': 'end' }, usd(Math.pow(10, e))), svg('text', { x: sx(Math.pow(10, e)), y: H - P + 16, class: 'axis', 'text-anchor': 'middle' }, usd(Math.pow(10, e))));
    s.append(svg('line', { x1: sx(Math.pow(10, lo)), y1: sy(Math.pow(10, lo)), x2: sx(Math.pow(10, hi)), y2: sy(Math.pow(10, hi)), class: 'diag' }));
    pts.forEach((o) => s.append(svg('circle', { cx: sx(o.predicted), cy: sy(o.actual), r: 3.6, class: o.test ? 'pt test' : 'pt' })));
    s.append(svg('text', { x: (W + P) / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }, 'Model estimate (out of fold)'), svg('text', { x: 11, y: H / 2, class: 'axis', transform: 'rotate(-90 11 ' + H / 2 + ')', 'text-anchor': 'middle' }, 'Actual market cap'));
    return s;
  }
  const mt = (cap, heads, rows) => h('table', { class: 'mt' }, h('caption', { text: cap }), h('thead', null, h('tr', null, heads.map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: x })))), h('tbody', null, rows.map((r) => h('tr', { class: r[2] ? 'sel' : '' }, h('th', { scope: 'row', text: r[0] }), r[1].map((x) => h('td', { class: 'num', text: x }))))));
  const MH = ['Model', 'R²', 'Median error', 'Within ×2', 'Within ×5', 'Rank corr.'];
  const mrow = (m) => [f2(m.r2), '×' + m.median_factor.toFixed(1), p0(m.within_2x), p0(m.within_5x), f2(m.spearman)];
  const byId = (set, cap) => mt(cap, MH, M.labels.map((l) => [l.label + (l.id === M.chosen ? ' (shipped)' : ''), mrow(set[l.id]), l.id === M.chosen]));
  function best(set, key) { return M.labels.reduce((a, l) => set[l.id][key] > set[a.id][key] ? l : a, M.labels[0]); }

  function renderModel() {
    const T = M.time, H = M.hold, ho = M.held_out, cv = M.cross_validated, ch = ho[M.chosen], tc = T.chosen, top = D.rows.slice(0, 16).map((r) => r.v), widths = D.rows.map((r) => r.rr[1] - r.rr[0]).sort((a, b) => a - b);
    const bR = best(ho, 'r2'), bS = best(ho, 'spearman');
    const sure = M.terms.filter((x) => x.used && (x.id === 'tvl' ? x.lo > 0 || x.hi < 0 : x.lo > 1 || x.hi < 1));
    return [
      h('section', null, h('h2', { text: 'The value model and how it was chosen' }),
        h('p', null, 'The snapshot has no token values for pre-token protocols, so the model borrows them from ' + M.n + ' protocols that already trade (original protocols only: wrapped, staked, bridged, exchange and versioned products excluded). It fits log market cap by ridge regression. Candidate term sets run from TVL alone to TVL, 7-day growth (capped at -50% to +100%), log age since DefiLlama listed the protocol, an age-unknown flag and four category groups; each set tries eight penalties.'),
        h('p', null, 'Choice rule, fixed before looking at the held-out set: for each set the best penalty is the one with the highest out-of-fold score (R² + rank correlation, 4 repeats of 8-fold cross-validation); the winner is the simplest set within ' + E.TOLERANCE + ' of the best score. On all ' + M.n + ' rows that is ', h('strong', { text: label(M.chosen) + ', penalty ' + M.lambda }), '. A range for each value comes from its out-of-fold residuals. No protocol name is treated specially.'),
        mt('Selection on all ' + M.n + ' rows, out-of-fold (best penalty per term set)', ['Term set', 'Penalty', 'R²', 'Rank corr.', 'Score'], M.select.map((t) => [label(t.id) + (t.id === M.chosen ? ' (chosen)' : ''), [String(t.lambda), f2(t.r2), f2(t.rho), f2(t.score)], t.id === M.chosen]))),
      h('section', null, h('h2', { text: 'Held-out test (hash split)' }),
        h('p', null, 'A hash of the slug sets aside ' + H.n_test + ' of the ' + M.n + ' rows. The same choice rule run on the other ' + H.n_fit + ' picks ' + label(H.pick.id) + '; every term set is then scored once on the held-out rows.'),
        byId(ho, 'Held-out test, ' + H.n_test + ' protocols, each term set at its own cross-validated penalty'),
        h('p', null, h('strong', { text: 'Honest reading. ' }), 'The shipped model scores R² ' + f2(ch.r2) + ' and rank correlation ' + f2(ch.spearman) + ' held out (cross-validated over all rows: ' + f2(cv[M.chosen].r2) + ' and ' + f2(cv[M.chosen].spearman) + '), typically off by ×' + ch.median_factor.toFixed(1) + '. One median cap for all scores R² ' + f2(M.baseline_median.r2) + '. The best held-out R² in the table is ' + bR.label + ' (' + f2(ho[bR.id].r2) + ') and the best rank correlation is ' + bS.label + ' (' + f2(ho[bS.id].spearman) + '). With ' + H.n_test + ' rows these gaps are noise, so the model was chosen on cross-validation over all rows and not on this table. Survivors bias the sample too: protocols that never launched a token are not in it.'),
        h('p', null, 'The 50% range held ' + p0(H.cov50) + ' of the held-out rows and the 80% range ' + p0(H.cov80) + ' (ranges built from out-of-fold errors of the fit rows only; by design about 50% and 80%).')),
      h('section', null, h('h2', { text: 'Time-ordered test' }),
        h('p', null, 'Fit on the older listings (' + T.n_fit + ' rows, listed before ' + T.cutoff + ' or with no listing date), test on the newest ' + T.n_test + '. Choice rule on the fit side picks ' + label(T.pick.id) + '.'),
        byId(T.by_id, 'Time-ordered test, newest ' + T.n_test + ' listings'),
        h('p', null, 'On newer listings the picked model scores R² ' + f2(tc.r2) + ' and rank correlation ' + f2(tc.spearman) + '; the 50% range held ' + p0(T.cov50) + ' and the 80% range ' + p0(T.cov80) + '. ' + (tc.spearman < 0.2 ? 'The ordering learned from older listings does not carry to newer ones, so treat the ranking as weak evidence for protocols listed recently.' : 'The ordering carries to newer listings.'))),
      h('section', null, h('h2', { text: 'Cross-validation over all rows and the ranking' }),
        byId(cv, 'Repeated 10-fold cross-validation over all ' + M.n + ' rows (20 repeats)'),
        h('p', null, 'The top 16 implied values span ' + usd(top[15]) + ' to ' + usd(top[0]) + ' and the whole board ' + usd(D.rows[D.rows.length - 1].v) + ' to ' + usd(D.rows[0].v) + '. The 50% range of a row is ×' + Math.pow(10, M.band.q25).toFixed(2) + ' to ×' + Math.pow(10, M.band.q75).toFixed(2) + ' of its value. Values closer than the typical error (×' + D.rank_factor.toFixed(1) + ', the cross-validated median) cannot be told apart: for the median row that leaves a rank swing of ' + widths[Math.floor(widths.length / 2)] + ' places (Rank column: best to worst). The board is a tiering, not an exact order.')),
      h('section', null, h('h2', { text: 'Fitted terms of the shipped model' }),
        mt('Refit on all ' + M.n + ' rows; the interval is the 5th to 95th percentile of 200 bootstrap refits. Terms outside the model are zero effect.', ['Term', 'Value', '90% interval', 'Excludes no effect?'], M.terms.map((x) => [x.label, x.used ? [f2(x.value), f2(x.lo) + ' to ' + f2(x.hi), x.id === 'tvl' ? (x.lo > 0 || x.hi < 0 ? 'yes' : 'no') : (x.lo > 1 || x.hi < 1 ? 'yes' : 'no')] : ['not used', '', ''], false])),
        h('p', { class: 'sub', text: 'Intervals that exclude "no effect": ' + (sure.length ? sure.map((x) => x.label).join('; ') : 'none') + '.' })),
      h('section', null, h('h2', { text: 'Estimate against actual' }), scatter(), h('p', { class: 'sub', text: 'Each dot is a live token. The line is a perfect estimate; filled dots were held out of the first fit.' })),
      h('section', null, h('h2', { text: 'Check it in this page' }), h('button', { type: 'button', class: 'btn', onclick: refit }, 'Re-fit the model here'), h('p', { id: 'refit', class: 'sub', role: 'status', text: 'Runs engine.js on the comparable rows in data.js and compares it with the numbers main.ts wrote.' })),
      h('section', null, h('h2', { text: 'Assumptions behind the verdict and the plans' }),
        h('p', null, 'These are labelled assumptions, not snapshot figures. Change one in engine.js and every verdict moves.'),
        mt('Assumptions', ['Assumption', 'Value', 'Meaning'], [['Airdrop share', [p0(A.share), 'of an implied value a launch could hand to users'], false], ['Active-user weight', ['×' + A.active, 'your slice is capital × this ÷ TVL, at most all'], false], ['Value of an hour', ['$' + A.hour, 'priced into effort'], false], ['Cost of locked capital', [p0(A.rate) + ' a year', 'times capital times hold'], false], ['Farm / thin', ['≥ ' + A.farm + '× / ≥ ' + A.thin + '× cost', 'expected value against cost; else skip'], false]].concat(Object.entries(A.gas).map(([k, g]) => ['Gas per transaction, ' + k, ['$' + g[0] + ' to $' + g[1], k === 'l2' ? 'L2 and low-fee chains' : k === 'other' ? 'any other chain' : 'assumed range, check the live fee'], false]))),
        h('p', null, 'Odds: peers are original protocols in the same age band and TVL band (at least ' + D.odds_min_peers + ' needed, else the age band alone, then all); odds is the share of them that already record a token. It is estimated from the snapshot, and is a proxy, not a launch probability.'),
        mt('Capital tier by TVL (before the kind multiplier)', ['TVL', 'Capital'], D.tiers.map((t, i) => [i ? 'from ' + usd(D.tiers[i - 1][0]) + (t[0] ? ' to ' + usd(t[0]) : ' and up') : 'under ' + usd(t[0]), [usd(t[1])], false])),
        mt('Plan kinds: category picks the steps; transactions and minutes are for the first action, the second action and each weekly use.', ['Kind', 'Capital ×', 'Transactions', 'Minutes', 'Hold cap', 'Main risk'], D.kinds.map((k) => [k.label, ['×' + k.mult, k.tx.join(' / '), k.mins.join(' / '), k.cap + ' d', k.risk], false]))),
      h('section', null, h('h2', { text: 'Limits' }), h('p', null, 'DefiLlama records no token for these protocols; that is a record, not proof, and a token may exist that it does not carry. The snapshot is from ' + D.as_of + ' and fixed. The model does not predict whether or when a token launches; expected values rest on assumptions above; plans describe ordinary use of a protocol by one person with one wallet and promise nothing.'))
    ];
  }
  function refit() {
    const out = $('#refit'), t0 = performance.now();
    const m = E.fitValueModel(D.train, D.as_of);
    const diff = Math.max(...m.w.map((w, i) => Math.abs(w - M.w[i])), Math.abs(m.intercept - M.intercept));
    out.textContent = (diff < 1e-6 && m.chosen === M.chosen ? 'Match: ' : 'Differs: ') + 'chosen ' + m.chosen + ', largest coefficient gap ' + diff.toExponential(1) + ', held-out R² ' + f2(m.held_out[m.chosen].r2) + ' against ' + f2(M.held_out[M.chosen].r2) + ', ' + Math.round(performance.now() - t0) + ' ms.';
  }

  // ---- shell ------------------------------------------------------------------------------------------------
  function fillSelects() {
    const cats = [...new Set(D.rows.map((r) => r.cat || 'No category'))].sort(), chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
    $('#cat').append(...cats.map((c) => h('option', { value: c, text: c })));
    $('#chain').append(...chains.map((c) => h('option', { value: c, text: c })));
  }
  function sync() {
    for (const v of ['board', 'live', 'model']) { $('#v-' + v).hidden = state.v !== v; $('#t-' + v).setAttribute('aria-selected', String(state.v === v)); }
    for (const k of ['q', 'cat', 'chain', 'scope', 'vd', 'lq']) $('#' + k).value = state[k];
    $('#sortsel').value = state.sort + ':' + state.dir;
    if (state.v === 'board') { renderBoard(); renderPanel(); } else if (state.v === 'live') renderLive();
    else if (!$('#v-model').childElementCount) $('#v-model').append(...renderModel());
    $('#summary').textContent = D.counts.board + ' pre-token protocols ranked (' + D.counts.watchlist + ' on the watchlist, ' + D.counts.early + ' beyond it) from the ' + D.as_of + ' snapshot of ' + D.counts.protocols + ' protocols.';
    writeHash();
  }
  function init() {
    readHash();
    fillSelects();
    renderCover();
    $('#q').addEventListener('input', (e) => { state.q = e.target.value; sync(); });
    $('#lq').addEventListener('input', (e) => { state.lq = e.target.value; sync(); });
    for (const id of ['cat', 'chain', 'scope', 'vd']) $('#' + id).addEventListener('change', (e) => { state[id] = e.target.value; sync(); });
    $('#sortsel').addEventListener('change', (e) => { const [k, d] = e.target.value.split(':'); state.sort = k; state.dir = +d; sync(); });
    $('#reset').addEventListener('click', () => { Object.assign(state, { q: '', cat: 'all', chain: 'all', scope: 'all', vd: 'all' }); sync(); });
    for (const v of ['board', 'live', 'model']) $('#t-' + v).addEventListener('click', () => { state.v = v; sync(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.p) open(''); });
    window.addEventListener('hashchange', () => { readHash(); sync(); });
    sync();
    $('#app').removeAttribute('aria-busy');
  }
  init();
})();
