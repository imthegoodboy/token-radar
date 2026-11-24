// Token Radar engine: one pure module that main.ts runs to write board.json and the page runs to re-check it.
// Value model (ridge fit on live-token protocols, model choice by cross-validation, hash and time-ordered tests,
// bootstrap) and the net-value verdict with its labelled assumptions. No protocol is named: every figure comes from
// the snapshot. Farm plans are built beside it in lib/plans.ts and arrive in data.js.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RadarEngine = api;
})(this, function () {
  'use strict';

  var DAY = 86400000;
  var GROWTH_MIN = -50, GROWTH_MAX = 100; // per cent: the clamp on seven-day TVL change
  var LAMBDAS = [0.1, 0.3, 1, 3, 10, 30, 100, 300];
  var TOLERANCE = 0.02; // score points within which a simpler term set is preferred
  // Feature order: 0 log10 TVL, 1 growth, 2 log2 age, 3 age unknown, 4..7 category group dummies.
  var GROUPS = ['credit', 'dex', 'vault', 'rwa']; // derivatives and the rest fall into 'other'
  var ABLATIONS = [
    { id: 'tvl', label: 'TVL only', cols: [0] },
    { id: 'tvl+growth', label: 'TVL + growth', cols: [0, 1] },
    { id: 'tvl+age', label: 'TVL + age', cols: [0, 2, 3] },
    { id: 'tvl+group', label: 'TVL + category group', cols: [0, 4, 5, 6, 7] },
    { id: 'full', label: 'All terms', cols: [0, 1, 2, 3, 4, 5, 6, 7] }
  ];
  // ASSUMPTIONS, not snapshot facts: the page lists each with its value. Gas is dollars per simple transaction, [low, high].
  var ASSUME = {
    share: 0.1, active: 10, hour: 10, rate: 0.05, farm: 2, thin: 1,
    gas: { Ethereum: [0.3, 5], Bitcoin: [1, 5], Tron: [0.3, 2], Solana: [0.002, 0.05], l2: [0.01, 0.3], other: [0.05, 1] }
  };
  var L2 = /Arbitrum|Base|Optimism|OP Mainnet|Polygon|Linea|Scroll|zkSync|Blast|Mantle|Mode|Sonic|Berachain|Unichain|Ink|Avalanche|Binance|BSC|Plasma|Hyperliquid|Sei|Sui|Aptos|TON|Near|Cronos|Gnosis|xDai/i;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }

  function groupOf(category) {
    var c = (category || '').toLowerCase();
    if (/lend|cdp|collateral|borrow/.test(c)) return 'credit';
    if (/dex|liquidity|swap|launchpad|farm/.test(c)) return 'dex';
    if (/yield|basis|aggregator|index|vault|allocator|curator/.test(c)) return 'vault';
    if (/rwa|stable/.test(c)) return 'rwa';
    return 'other';
  }

  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY));
  }

  /** The eight raw features of one protocol (a snapshot entry). */
  function features(p, asOf) {
    var age = ageDays(asOf, p.listed_at);
    var g = clamp(typeof p.change_7d === 'number' ? p.change_7d : 0, GROWTH_MIN, GROWTH_MAX) / 100;
    var grp = groupOf(p.category);
    var f = [Math.log10(Math.max(p.tvl_usd, 1) / 1e7), g, age === null ? 0 : Math.log2(age + 30) - 10, age === null ? 1 : 0];
    for (var i = 0; i < GROUPS.length; i++) f.push(grp === GROUPS[i] ? 1 : 0);
    return f;
  }

  /** Deterministic generator (32-bit linear congruential): same seed, same numbers, any machine. */
  function lcg(seed) {
    var s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  function fnv(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function solve(A, b) {
    var n = b.length, i, r, c;
    for (i = 0; i < n; i++) {
      var m = i;
      for (r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
      var t = A[i]; A[i] = A[m]; A[m] = t;
      var u = b[i]; b[i] = b[m]; b[m] = u;
      for (r = i + 1; r < n; r++) {
        var f = A[r][i] / A[i][i];
        for (c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }

  /** Ridge fit on standardised columns; coefficients come back in the features' own units. */
  function fitRidge(X, y, cols, lambda) {
    var n = X.length, k = cols.length, i, j, a, mu = [], sd = [];
    for (j = 0; j < k; j++) {
      var m = 0, v = 0;
      for (i = 0; i < n; i++) m += X[i][cols[j]];
      m /= n;
      for (i = 0; i < n; i++) v += Math.pow(X[i][cols[j]] - m, 2);
      mu.push(m); sd.push(Math.sqrt(v / n) || 1);
    }
    var ybar = mean(y), A = [], b = [];
    for (a = 0; a < k; a++) { A.push(new Array(k).fill(0)); b.push(0); }
    for (i = 0; i < n; i++) {
      for (a = 0; a < k; a++) {
        var za = (X[i][cols[a]] - mu[a]) / sd[a];
        b[a] += za * (y[i] - ybar);
        for (j = 0; j < k; j++) A[a][j] += za * ((X[i][cols[j]] - mu[j]) / sd[j]);
      }
    }
    for (a = 0; a < k; a++) A[a][a] += lambda;
    var ws = solve(A, b), w = new Array(8).fill(0), icpt = ybar;
    for (a = 0; a < k; a++) { w[cols[a]] = ws[a] / sd[a]; icpt -= w[cols[a]] * mu[a]; }
    return { intercept: icpt, w: w, cols: cols, lambda: lambda };
  }

  function predictLog(model, f) {
    var s = model.intercept;
    for (var j = 0; j < f.length; j++) s += model.w[j] * f[j];
    return s;
  }

  function rank(a) {
    var idx = a.map(function (_, i) { return i; }).sort(function (p, q) { return a[p] - a[q] || p - q; });
    var r = new Array(a.length);
    idx.forEach(function (i, pos) { r[i] = pos; });
    return r;
  }

  function spearman(a, b) {
    var ra = rank(a), rb = rank(b), n = a.length, ma = (n - 1) / 2, num = 0, da = 0, db = 0;
    for (var i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += Math.pow(ra[i] - ma, 2); db += Math.pow(rb[i] - ma, 2); }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  function quantile(sorted, q) {
    var pos = q * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function sortNum(a) { return a.slice().sort(function (p, q) { return p - q; }); }

  /** Errors are in log10 dollars: factor = 10^|error|, so "2x" means the value was off by a factor of two. */
  function metrics(actual, pred, baseMean) {
    var n = actual.length, i, sse = 0, sst = 0, abs = [];
    for (i = 0; i < n; i++) {
      var e = actual[i] - pred[i];
      sse += e * e; sst += Math.pow(actual[i] - baseMean, 2); abs.push(Math.abs(e));
    }
    abs.sort(function (p, q) { return p - q; });
    var within = function (f) { return abs.filter(function (e) { return e <= Math.log10(f); }).length / n; };
    return { n: n, r2: 1 - sse / sst, median_factor: Math.pow(10, quantile(abs, 0.5)), within_2x: within(2), within_5x: within(5), spearman: spearman(actual, pred) };
  }

  /** Repeated K-fold: each row's out-of-fold prediction is the mean over the repeats. */
  function crossValidate(X, y, cols, lambda, reps, K, seed) {
    var n = X.length, sum = new Array(n).fill(0), r, k, i;
    for (r = 0; r < reps; r++) {
      var rnd = lcg(seed + r), idx = [];
      for (i = 0; i < n; i++) idx.push(i);
      for (i = n - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (k = 0; k < K; k++) {
        var tr = [], te = [];
        for (i = 0; i < n; i++) (i % K === k ? te : tr).push(idx[i]);
        var m = fitRidge(tr.map(function (q) { return X[q]; }), tr.map(function (q) { return y[q]; }), cols, lambda);
        te.forEach(function (q) { sum[q] += predictLog(m, X[q]); });
      }
    }
    return sum.map(function (s) { return s / reps; });
  }

  /**
   * Model choice by cross-validation. For every term set the best penalty is the one with the highest out-of-fold
   * score, score = R2 + rank correlation (both out of fold). The winner is the simplest term set (listed first)
   * whose score is within TOLERANCE of the best: differences that small are noise on this few rows. Only the rows
   * passed in are used.
   */
  function select(X, y, seed) {
    var tops = ABLATIONS.map(function (ab) {
      var top = null;
      LAMBDAS.forEach(function (l) {
        var m = metrics(y, crossValidate(X, y, ab.cols, l, 4, 8, seed), mean(y)), sc = m.r2 + m.spearman;
        if (!top || sc > top.score) top = { id: ab.id, cols: ab.cols, lambda: l, score: sc, r2: m.r2, rho: m.spearman };
      });
      return top;
    });
    var top = Math.max.apply(null, tops.map(function (t) { return t.score; })), best = tops.filter(function (t) { return t.score >= top - TOLERANCE; })[0];
    return { tops: tops, best: best };
  }

  /** Fit side and test side of a split: choose by CV on the fit side, score every term set once on the test side. */
  function evalSplit(X, y, fi, ti, seed) {
    var pick = function (idx, a) { return idx.map(function (q) { return a[q]; }); };
    var Xa = pick(fi, X), ya = pick(fi, y), Xt = pick(ti, X), yt = pick(ti, y), sel = select(Xa, ya, seed), base = mean(ya), byId = {};
    sel.tops.forEach(function (t) {
      var m = fitRidge(Xa, ya, t.cols, t.lambda);
      byId[t.id] = metrics(yt, Xt.map(function (f) { return predictLog(m, f); }), base);
      byId[t.id].lambda = t.lambda;
    });
    var b = sel.best, mb = fitRidge(Xa, ya, b.cols, b.lambda), res = sortNum(crossValidate(Xa, ya, b.cols, b.lambda, 10, 8, seed + 1).map(function (o, q) { return ya[q] - o; }));
    var q = function (p) { return quantile(res, p); }, inside = function (lo, hi) {
      return yt.filter(function (v, k) { var e = v - predictLog(mb, Xt[k]); return e >= q(lo) && e <= q(hi); }).length / yt.length;
    };
    var med = quantile(sortNum(ya), 0.5);
    return { n_fit: fi.length, n_test: ti.length, select: sel.tops, pick: { id: b.id, lambda: b.lambda }, by_id: byId, chosen: byId[b.id], cov50: inside(0.25, 0.75), cov80: inside(0.1, 0.9), baseline: metrics(yt, yt.map(function () { return med; }), base) };
  }

  /** Natural-unit reading of a fit: elasticity, growth per +10 points, factor per doubling of age, group factors. */
  function terms(model) {
    var c = model.cols, has = function () { for (var i = 0; i < arguments.length; i++) if (c.indexOf(arguments[i]) >= 0) return true; return false; };
    return [
      { id: 'tvl', label: 'TVL elasticity (exponent on TVL)', value: model.w[0], used: has(0) },
      { id: 'growth', label: 'Factor per +10 points of 7d growth', value: Math.pow(10, model.w[1] * 0.1), used: has(1) },
      { id: 'age', label: 'Factor per doubling of age', value: Math.pow(10, model.w[2]), used: has(2) },
      { id: 'unknown', label: 'Factor when age is unknown', value: Math.pow(10, model.w[3]), used: has(3) }
    ].concat(GROUPS.map(function (g, i) { return { id: 'g_' + g, label: 'Factor, ' + g + ' vs other', value: Math.pow(10, model.w[4 + i]), used: has(4 + i) }; }));
  }

  /**
   * The whole fit. train: snapshot entries with a market cap. A hash split holds out a quarter; a time split holds out
   * the newest quarter by listing date; each is scored once after the model is chosen on the rest. The shipped model
   * is chosen by cross-validation on everything and refit; bootstrap resamples give each term an interval.
   */
  function fitValueModel(train, asOf) {
    var X = train.map(function (p) { return features(p, asOf); });
    var y = train.map(function (p) { return Math.log10(p.mcap_usd / 1e7); });
    var n = y.length, i, fi = [], ti = [];
    train.forEach(function (p, q) { (fnv(p.slug) % 4 === 0 ? ti : fi).push(q); });
    var hold = evalSplit(X, y, fi, ti, 101);
    var dated = [], old = [];
    train.forEach(function (p, q) { (ageDays(asOf, p.listed_at) === null ? old : dated).push(q); });
    dated.sort(function (p, q) { return ageDays(asOf, train[q].listed_at) - ageDays(asOf, train[p].listed_at) || p - q; });
    var cut = Math.floor(dated.length * 0.75), time = evalSplit(X, y, old.concat(dated.slice(0, cut)), dated.slice(cut), 111);
    time.cutoff = dated.length > cut ? train[dated[cut]].listed_at : null;

    var all = select(X, y, 202), cvAll = {}, oof = null;
    all.tops.forEach(function (t) {
      var o = crossValidate(X, y, t.cols, t.lambda, 20, 10, 303);
      cvAll[t.id] = metrics(y, o, mean(y));
      cvAll[t.id].lambda = t.lambda;
      if (t.id === all.best.id) oof = o;
    });
    var best = all.best, model = fitRidge(X, y, best.cols, best.lambda);
    var boots = [], rnd = lcg(404), b, ids;
    for (b = 0; b < 200; b++) {
      ids = [];
      for (i = 0; i < n; i++) ids.push(Math.floor(rnd() * n));
      boots.push(terms(fitRidge(ids.map(function (q) { return X[q]; }), ids.map(function (q) { return y[q]; }), best.cols, best.lambda)));
    }
    var shipped = terms(model).map(function (t, j) {
      var vals = sortNum(boots.map(function (bt) { return bt[j].value; }));
      return { id: t.id, label: t.label, value: t.value, used: t.used, lo: quantile(vals, 0.05), hi: quantile(vals, 0.95) };
    });
    var res = sortNum(oof.map(function (o, q) { return y[q] - o; }));
    var band = { q10: quantile(res, 0.1), q25: quantile(res, 0.25), q75: quantile(res, 0.75), q90: quantile(res, 0.9) };
    return {
      n: n, lambda: best.lambda, chosen: best.id, intercept: model.intercept, w: model.w, cols: best.cols,
      terms: shipped, band: band, select: all.tops, hold: hold, time: time, held_out: hold.by_id, cross_validated: cvAll, baseline_median: hold.baseline,
      labels: ABLATIONS.map(function (a) { return { id: a.id, label: a.label }; }),
      oof: train.map(function (p, q) { return { slug: p.slug, actual: p.mcap_usd, predicted: Math.round(Math.pow(10, oof[q]) * 1e7), test: ti.indexOf(q) >= 0 }; })
    };
  }

  /** A protocol's implied value: the model's typical (median) market cap in dollars, with its 50% and 80% range. */
  function impliedValue(model, p, asOf) {
    var f = features(p, asOf), lg = predictLog(model, f), at = function (e) { return Math.max(1, Math.round(Math.pow(10, lg + e) * 1e7)); };
    return { value: at(0), lo50: at(model.band.q25), hi50: at(model.band.q75), lo80: at(model.band.q10), hi80: at(model.band.q90),
      parts: { tvl: model.w[0] * f[0], growth: model.w[1] * f[1], age: model.w[2] * f[2] + model.w[3] * f[3], group: f.slice(4).reduce(function (s, v, j) { return s + v * model.w[4 + j]; }, 0) } };
  }

  /** Dollars per simple transaction on a chain, [low, high]: an assumption (ASSUME.gas), never a snapshot figure. */
  function gasRange(chain) {
    var g = ASSUME.gas;
    return g[chain] || (L2.test(chain) ? g.l2 : g.other);
  }

  /**
   * Net verdict. Your slice if a token launches = capital x active weight / TVL (at most all of it); gross = implied
   * value x airdrop share x slice; expected value = gross x odds. Cost = capital x yearly rate x hold + gas (high end)
   * + hours x hourly value. farm: expected value at least 2x cost; thin: at least 1x; skip: below.
   */
  function netValue(v, tvl, odds, plan) {
    var slice = Math.min(1, plan.capital * ASSUME.active / Math.max(tvl, 1)), gross = v * ASSUME.share * slice, ev = gross * odds;
    var cost = plan.capital * ASSUME.rate * plan.hold / 365 + plan.gas_hi + plan.hours * ASSUME.hour;
    return { slice: slice, gross: gross, ev: ev, cost: cost, verdict: ev >= cost * ASSUME.farm ? 'farm' : ev >= cost * ASSUME.thin ? 'thin' : 'skip' };
  }

  return { features: features, fitValueModel: fitValueModel, impliedValue: impliedValue, netValue: netValue, gasRange: gasRange, groupOf: groupOf, ageDays: ageDays, terms: terms, ABLATIONS: ABLATIONS, ASSUME: ASSUME, TOLERANCE: TOLERANCE };
});
