// Token Radar page. Reads window.RADAR (data.js, written by main.ts beside this folder) and window.RadarEngine
// (engine.js, the same file main.ts runs). Board: renderBoard, renderDetail. Already trading: renderLive.
// Model: renderModel, refit (re-runs the fit in this page and compares it with the build's numbers).
(() => {
  'use strict';
  const D = window.RADAR, E = window.RadarEngine;
  if (!D || !E) { document.body.textContent = 'data.js did not load: run main.ts and open output/dashboard/index.html.'; return; }
  const M = D.model;
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

  const usd = (n) => n === null || n === undefined || !isFinite(n) ? 'n/a' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n);
  const pct = (n) => n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const age = (d) => d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d';
  const mult = (x) => '×' + (x >= 10 ? x.toFixed(0) : x.toFixed(2));
  const lines = (p, n) => p.chains.length <= n ? p.chains.join(', ') : p.chains.slice(0, n).join(', ') + ' +' + (p.chains.length - n);

  // ---- state in the address hash, so every view can be linked --------------------------------------------
  const state = { v: 'board', q: '', cat: 'all', chain: 'all', scope: 'all', sort: 'r', dir: 1, p: '', lsort: 'mcap', ldir: -1, lq: '' };
  const KEYS = ['v', 'q', 'cat', 'chain', 'scope', 'sort', 'p', 'lsort', 'lq'];
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

  // ---- one sortable table builder for both lists ---------------------------------------------------------
  function table(caption, cols, rows, sortKey, dir, onSort, onPick, selected) {
    const head = h('tr', null, cols.map((c) => h('th', { scope: 'col', class: c.cls, 'aria-sort': c.k === sortKey ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
      h('button', { type: 'button', class: 'sort', onclick: () => onSort(c.k, c.k === sortKey ? -dir : c.first || 1) }, c.label, h('span', { 'aria-hidden': 'true', class: 'caret', text: c.k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '' })))));
    const body = rows.map((r) => h('tr', { class: selected && r.slug === selected ? 'sel' : '', onclick: onPick ? () => onPick(r.slug) : null }, cols.map((c) => h('td', { class: c.cls }, c.cell(r)))));
    return h('table', null, h('caption', { class: 'sr', text: caption }), h('thead', null, head), h('tbody', null, body));
  }
  function sorted(rows, cols, key, dir) {
    const c = cols.find((x) => x.k === key) || cols[0];
    return rows.slice().sort((a, b) => {
      const x = c.val(a), y = c.val(b);
      const nx = x === null || x === undefined, ny = y === null || y === undefined;
      if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.slug < b.slug ? -1 : 1);
    });
  }

  // ---- board ----------------------------------------------------------------------------------------------
  const boardCols = [
    { k: 'r', label: '#', cls: 'num', val: (r) => r.r, cell: (r) => String(r.r) },
    { k: 'name', label: 'Protocol', first: 1, val: (r) => r.name.toLowerCase(), cell: (r) => h('div', { class: 'who' }, h('div', { class: 'nm' }, h('button', { type: 'button', class: 'pick', onclick: (e) => { e.stopPropagation(); open(r.slug); }, 'aria-label': 'Open detail for ' + r.name, text: r.name }), r.wl ? h('span', { class: 'tag', text: 'watchlist' }) : null), h('span', { class: 'sub', text: (r.cat || 'No category') + ' · ' + lines(r, 2) })) },
    { k: 'v', label: 'Implied value', cls: 'num', first: -1, val: (r) => r.v, cell: (r) => [h('strong', { text: usd(r.v) }), h('span', { class: 'sub', text: usd(r.lo) + ' to ' + usd(r.hi) })] },
    { k: 'tvl', label: 'TVL', cls: 'num', first: -1, val: (r) => r.tvl, cell: (r) => usd(r.tvl) },
    { k: 'g', label: '7d', cls: 'num', first: -1, val: (r) => r.g, cell: (r) => h('span', { class: r.g > 0 ? 'up' : r.g < 0 ? 'down' : '', text: pct(r.g) }) },
    { k: 'age', label: 'No token for', cls: 'num', first: -1, val: (r) => r.age, cell: (r) => age(r.age) },
    { k: 'cost', label: 'Farm cost', cls: 'num', first: 1, val: (r) => r.plan.gas, cell: (r) => [h('span', { text: usd(r.plan.capital) + ' + ' + (r.plan.gas < 10 ? '$' + r.plan.gas.toFixed(2) : usd(r.plan.gas)) }), h('span', { class: 'sub', text: r.plan.hold + ' d hold' })] }
  ];
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return D.rows.filter((r) => (state.cat === 'all' || (r.cat || 'No category') === state.cat) && (state.chain === 'all' || r.chains.includes(state.chain)) &&
      (state.scope === 'all' || (state.scope === 'wl') === r.wl) && (!q || (r.name + ' ' + r.slug + ' ' + (r.cat || '') + ' ' + r.chains.join(' ')).toLowerCase().includes(q)));
  }
  function renderBoard() {
    const rows = sorted(filtered(), boardCols, state.sort, state.dir);
    $('#count').textContent = rows.length + ' of ' + D.rows.length + ' protocols' + (rows.length ? '' : ': nothing matches, clear a filter');
    $('#board-table').replaceChildren(table('Pre-token protocols ranked by implied value', boardCols, rows, state.sort, state.dir, (k, d) => { state.sort = k; state.dir = d; sync(); }, open, state.p));
    const filters = [state.q, state.cat !== 'all', state.chain !== 'all', state.scope !== 'all'].some(Boolean);
    $('#reset').hidden = !filters;
  }

  function stat(label, value, note) { return h('div', { class: 'stat' }, h('span', { class: 'k', text: label }), h('strong', { text: value }), note ? h('span', { class: 'sub', text: note }) : null); }

  function renderIdle() {
    const t = M.held_out.full;
    return [
      h('h2', { text: 'How to read this board' }),
      h('p', null, 'Every row is a protocol DefiLlama records no token for. Its ', h('strong', { text: 'implied value' }), ' is the market cap a token typically has among ' + M.n + ' protocols that already trade, after matching on TVL, 7-day growth, age and category.'),
      h('div', { class: 'stats' }, stat('Held-out median error', '×' + t.median_factor.toFixed(1), 'on ' + M.n_test + ' protocols the fit never saw'), stat('Held-out R²', t.r2.toFixed(2), 'little of the spread is explained'), stat('50% range holds', Math.round(M.test_in_50_band * 100) + '%', 'of held-out cases, by design near 50')),
      h('p', { class: 'warn', text: 'Treat each figure as a range, not a price. The model ranks protocols by what comparable tokens are worth; it does not predict whether or when a token launches.' }),
      h('p', null, 'Select a row for its value breakdown and a costed farm plan. The Model tab shows every coefficient, the tests and their limits.')
    ];
  }

  function bar(r) {
    const lo = Math.log10(r.lo80), hi = Math.log10(r.hi80), at = (v) => 8 + ((Math.log10(v) - lo) / (hi - lo)) * 304;
    return svg('svg', { viewBox: '0 0 320 54', class: 'range', role: 'img', 'aria-label': 'Implied value ' + usd(r.v) + ', 50% range ' + usd(r.lo) + ' to ' + usd(r.hi) + ', 80% range ' + usd(r.lo80) + ' to ' + usd(r.hi80) },
      svg('line', { x1: 8, x2: 312, y1: 26, y2: 26, class: 'r80' }), svg('line', { x1: at(r.lo), x2: at(r.hi), y1: 26, y2: 26, class: 'r50' }), svg('circle', { cx: at(r.v), cy: 26, r: 6, class: 'dot' }),
      svg('text', { x: 8, y: 49, class: 'axis' }, usd(r.lo80)), svg('text', { x: 312, y: 49, class: 'axis', 'text-anchor': 'end' }, usd(r.hi80)), svg('text', { x: at(r.v), y: 12, class: 'axis', 'text-anchor': 'middle' }, usd(r.v)));
  }

  function renderDetail(r) {
    const p = r.parts, base = Math.pow(10, M.intercept) * 1e7;
    const f = (x) => Math.pow(10, x);
    const why = [
      ['Starting point', 'a $10M protocol, flat for 7 days, about 1,000 days old, category "other"', usd(base)],
      ['TVL ' + usd(r.tvl), 'exponent ' + M.w[0].toFixed(2) + ' on TVL', mult(f(p.tvl))],
      ['7-day growth ' + pct(r.g), r.g !== null && (r.g > 100 || r.g < -50) ? 'capped to the -50% to +100% range' : 'fitted per-point effect', mult(f(p.growth))],
      ['No token for ' + age(r.age), r.age === null ? 'age unknown: its own fitted factor' : 'fitted effect of log age', mult(f(p.age))],
      ['Category ' + (r.cat || 'none'), 'fitted group factor', mult(f(p.group))]
    ];
    const pl = r.plan;
    return [
      h('div', { class: 'dhead' }, h('div', null, h('h2', { id: 'dname', text: r.name }), h('p', { class: 'sub', text: '#' + r.r + ' of ' + D.rows.length + ' · ' + (r.cat || 'No category') + ' · ' + lines(r, 4) })), h('button', { type: 'button', class: 'close', onclick: () => open(''), 'aria-label': 'Close detail' }, '×')),
      h('p', { class: 'tags' }, h('span', { class: 'tag', text: r.wl ? 'on the watchlist' : 'beyond the watchlist' }), h('span', { class: 'tag', text: 'no token recorded' }), h('code', { text: 'defillama.com/protocol/' + r.slug })),
      h('div', { class: 'valuebox' }, h('div', null, h('span', { class: 'k', text: 'Implied value' }), h('strong', { class: 'big', text: usd(r.v) }), h('span', { class: 'sub', text: 'typical market cap of a comparable live token' })), bar(r)),
      h('h3', { text: 'Why this number (each factor fitted on live tokens)' }),
      h('ul', { class: 'eq', 'aria-label': 'How the implied value is built' }, why.map((w) => h('li', { title: w[1] }, h('span', { text: w[0] }), h('strong', { text: w[2] }))), h('li', { class: 'total' }, h('span', { text: '= recomputed here' }), h('strong', { text: usd(E.impliedValue(M, { tvl_usd: r.tvl, change_7d: r.g, listed_at: r.age === null ? null : listedFrom(r.age), category: r.cat }, D.as_of).value) }))),
      h('h3', { text: 'Farm plan' }),
      h('div', { class: 'stats small' }, stat('Capital locked', usd(pl.capital)), stat('Gas, all steps', '$' + pl.gas.toFixed(2)), stat('Hold', pl.hold + ' days'), stat('Your time', '~' + pl.hours + ' h')),
      h('ol', { class: 'plan' }, pl.steps.map((s) => h('li', null, h('span', { text: s.t }), h('span', { class: 'cm' }, h('b', { text: 'Cost ' }), s.c, h('b', { text: '  Time ' }), s.m)))),
      h('p', { class: 'sub', text: 'Gas figures assume a typical fee on ' + (pl.steps[1].t.match(/gas on (.*)\. Keep/) || [0, 'the chain'])[1] + ' (see the Model tab); capital is sized so gas stays near 4% of the position. Farming a protocol that has not announced a token may earn nothing.' })
    ];
  }
  const listedFrom = (days) => new Date(Date.parse(D.as_of + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);

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
    const lo = Math.floor(Math.log10(Math.min(...pts.map((o) => Math.min(o.actual, o.predicted)))) ), hi = Math.ceil(Math.log10(Math.max(...pts.map((o) => Math.max(o.actual, o.predicted)))));
    const sx = (v) => P + ((Math.log10(v) - lo) / (hi - lo)) * (W - P - 12), sy = (v) => H - P - ((Math.log10(v) - lo) / (hi - lo)) * (H - P - 12);
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'scatter', role: 'img', 'aria-label': 'Scatter of out-of-fold predicted against actual market cap for ' + pts.length + ' live tokens; points follow the diagonal loosely' });
    for (let e = lo; e <= hi; e++) {
      s.append(svg('line', { x1: P, x2: W - 12, y1: sy(Math.pow(10, e)), y2: sy(Math.pow(10, e)), class: 'grid' }), svg('text', { x: P - 6, y: sy(Math.pow(10, e)) + 4, class: 'axis', 'text-anchor': 'end' }, usd(Math.pow(10, e))), svg('text', { x: sx(Math.pow(10, e)), y: H - P + 16, class: 'axis', 'text-anchor': 'middle' }, usd(Math.pow(10, e))));
    }
    s.append(svg('line', { x1: sx(Math.pow(10, lo)), y1: sy(Math.pow(10, lo)), x2: sx(Math.pow(10, hi)), y2: sy(Math.pow(10, hi)), class: 'diag' }));
    pts.forEach((o) => s.append(svg('circle', { cx: sx(o.predicted), cy: sy(o.actual), r: 3.6, class: o.test ? 'pt test' : 'pt' })));
    s.append(svg('text', { x: (W + P) / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }, 'Model estimate (out of fold)'), svg('text', { x: 11, y: H / 2, class: 'axis', transform: 'rotate(-90 11 ' + H / 2 + ')', 'text-anchor': 'middle' }, 'Actual market cap'));
    return s;
  }
  const f2 = (x) => x.toFixed(2);
  function metricRow(label, m) { return h('tr', null, h('th', { scope: 'row', text: label }), [f2(m.r2), '×' + m.median_factor.toFixed(1), Math.round(m.within_2x * 100) + '%', Math.round(m.within_5x * 100) + '%', f2(m.spearman)].map((x) => h('td', { class: 'num', text: x }))); }
  function renderModel() {
    const t = M.held_out.full, cv = M.cross_validated.full;
    const mtable = (cap, set, extra) => h('table', { class: 'mt' }, h('caption', { text: cap }), h('thead', null, h('tr', null, ['Model', 'R²', 'Median error', 'Within ×2', 'Within ×5', 'Rank corr.'].map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: x })))), h('tbody', null, M.labels.map((l) => metricRow(l.label, set[l.id])), extra));
    return [
      h('section', null, h('h2', { text: 'The value model' }),
        h('p', null, 'The snapshot has no token values for pre-token protocols, so the model borrows them from protocols that already trade. It fits log market cap on log TVL, 7-day TVL growth (capped at -50% to +100%), log age since DefiLlama began tracking, whether age is known, and four category groups, using ridge regression (penalty ' + M.lambda + ', picked by cross-validation). Each pre-token protocol then gets the model\'s typical market cap, with a range taken from the cross-validated residuals. No protocol name is treated specially.'),
        h('p', null, 'Fitted on ' + M.n + ' live tokens of original protocols (wrapped, staked, bridged, exchange and versioned products excluded, as in the watchlist rule). Age here is days since DefiLlama listed the protocol; for a pre-token protocol that is also its time without a token.')),
      h('section', null, h('h2', { text: 'Fitted terms' }),
        h('table', { class: 'mt' }, h('caption', { text: 'Coefficients refit on all ' + M.n + ' protocols; interval is the 5th to 95th percentile of 200 bootstrap refits' }), h('thead', null, h('tr', null, ['Term', 'Value', '90% interval', 'Distinguishable from none?'].map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: x })))),
          h('tbody', null, M.terms.map((x) => { const none = x.id === 'tvl' ? 0 : 1; const sure = x.lo > none || x.hi < none; return h('tr', null, h('th', { scope: 'row', text: x.label }), h('td', { class: 'num', text: f2(x.value) }), h('td', { class: 'num', text: f2(x.lo) + ' to ' + f2(x.hi) }), h('td', { class: 'num', text: sure ? 'yes' : 'no' })); }))),
        h('p', { class: 'sub', text: 'Only TVL (and perhaps age) clearly separates from "no effect". Growth, the age-unknown flag and most category factors have intervals that include no effect, so their pull on the ranking is small.' })),
      h('section', null, h('h2', { text: 'Held-out test and cross-validation' }),
        h('p', null, 'A hash of the slug sets aside ' + M.n_test + ' of the ' + M.n + ' protocols. Every choice (penalty, terms) was made on the other ' + M.n_fit + '; the held-out set was scored once.'),
        mtable('Held-out test, ' + M.n_test + ' protocols', M.held_out, h('tr', null, h('th', { scope: 'row', text: 'Baseline: one median cap for all' }), [f2(M.baseline_median.r2), '×' + M.baseline_median.median_factor.toFixed(1), Math.round(M.baseline_median.within_2x * 100) + '%', Math.round(M.baseline_median.within_5x * 100) + '%', f2(M.baseline_median.spearman)].map((x) => h('td', { class: 'num', text: x })))),
        mtable('Repeated 10-fold cross-validation over all ' + M.n + ' protocols (20 repeats)', M.cross_validated),
        h('p', null, h('strong', { text: 'Honest reading. ' }), 'The full model explains about ' + Math.round(Math.max(0, cv.r2) * 100) + '% of the spread in log market cap out of fold (' + Math.round(Math.max(0, t.r2) * 100) + '% on the held-out set) and is typically off by a factor of ' + cv.median_factor.toFixed(1) + '. It does beat a single median cap, mainly by ordering protocols, but adding growth or category does not beat TVL alone here: the differences are inside the noise of ' + M.n_test + ' held-out cases. The terms stay because the radar is asked about them, shrunk by the penalty, not because the test rewards them. Survivors bias the sample too: protocols that failed to launch a token are not in it.')),
      h('section', null, h('h2', { text: 'Estimate against actual' }), scatter(), h('p', { class: 'sub', text: 'Each dot is a live token. The line is a perfect estimate; filled dots were held out of the first fit. The 50% range on each board row is the middle half of these errors: ×' + Math.pow(10, M.band.q25).toFixed(2) + ' to ×' + Math.pow(10, M.band.q75).toFixed(2) + '.' })),
      h('section', null, h('h2', { text: 'Check it in this page' }), h('button', { type: 'button', class: 'btn', onclick: refit }, 'Re-fit the model here'), h('p', { id: 'refit', class: 'sub', role: 'status', text: 'Runs engine.js on the comparable rows in data.js and compares it with the numbers main.ts wrote.' })),
      h('section', null, h('h2', { text: 'Farm plan assumptions' }), h('p', null, 'Plans are built by farmPlan in engine.js from category, first listed chain, TVL, age and 7-day growth. Hold days: 60 under 180 days old, 45 under a year, else 30 (30 if age is unknown). Capital is the gas total divided by 4%, rounded up to $50 and held between $100 and $2,000. Gas per transaction is a rough assumption, not a snapshot figure: Ethereum $' + E.GAS.Ethereum + ', Bitcoin $' + E.GAS.Bitcoin + ', Tron $' + E.GAS.Tron + ', Solana $' + E.GAS.Solana + ', common L2 and low-fee chains $0.12, others $0.30. Time is a typical hands-on estimate. Nothing guarantees an airdrop.')),
      h('section', null, h('h2', { text: 'Limits' }), h('p', null, 'DefiLlama records no token for these protocols; that is a record, not proof, and a token may exist that it does not carry. The snapshot is from ' + D.as_of + ' and fixed. The model does not predict whether or when a token launches, and the implied value is this page\'s own claim.'))
    ];
  }
  function refit() {
    const out = $('#refit'), t0 = performance.now();
    const m = E.fitValueModel(D.train, D.as_of);
    const diff = Math.max(...m.w.map((w, i) => Math.abs(w - M.w[i])), Math.abs(m.intercept - M.intercept));
    out.textContent = (diff < 1e-6 ? 'Match: ' : 'Differs: ') + 'largest coefficient gap ' + diff.toExponential(1) + ', held-out R² ' + f2(m.held_out.full.r2) + ' against ' + f2(M.held_out.full.r2) + ', ' + Math.round(performance.now() - t0) + ' ms.';
  }

  // ---- shell ------------------------------------------------------------------------------------------------
  function fillSelects() {
    const cats = [...new Set(D.rows.map((r) => r.cat || 'No category'))].sort(), chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
    $('#cat').append(...cats.map((c) => h('option', { value: c, text: c })));
    $('#chain').append(...chains.map((c) => h('option', { value: c, text: c })));
  }
  function sync() {
    for (const v of ['board', 'live', 'model']) { $('#v-' + v).hidden = state.v !== v; $('#t-' + v).setAttribute('aria-selected', String(state.v === v)); }
    $('#q').value = state.q; $('#cat').value = state.cat; $('#chain').value = state.chain; $('#scope').value = state.scope; $('#lq').value = state.lq;
    $('#sortsel').value = state.sort + ':' + state.dir;
    if (state.v === 'board') { renderBoard(); renderPanel(); } else if (state.v === 'live') renderLive();
    else if (!$('#v-model').childElementCount) $('#v-model').append(...renderModel());
    $('#summary').textContent = D.counts.board + ' pre-token protocols ranked (' + D.counts.watchlist + ' on the watchlist, ' + D.counts.early + ' beyond it) from the ' + D.as_of + ' snapshot of ' + D.counts.protocols + ' protocols.';
    writeHash();
  }
  function init() {
    readHash();
    fillSelects();
    $('#q').addEventListener('input', (e) => { state.q = e.target.value; sync(); });
    $('#lq').addEventListener('input', (e) => { state.lq = e.target.value; sync(); });
    for (const id of ['cat', 'chain', 'scope']) $('#' + id).addEventListener('change', (e) => { state[id] = e.target.value; sync(); });
    $('#sortsel').addEventListener('change', (e) => { const [k, d] = e.target.value.split(':'); state.sort = k; state.dir = +d; sync(); });
    $('#reset').addEventListener('click', () => { Object.assign(state, { q: '', cat: 'all', chain: 'all', scope: 'all' }); sync(); });
    for (const v of ['board', 'live', 'model']) $('#t-' + v).addEventListener('click', () => { state.v = v; sync(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.p) open(''); });
    window.addEventListener('hashchange', () => { readHash(); sync(); });
    sync();
    $('#app').removeAttribute('aria-busy');
  }
  init();
})();
