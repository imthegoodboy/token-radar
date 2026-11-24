// Token Radar engine: one pure module that main.ts runs to write board.json and the page runs to re-check it.
// It holds the value model (ridge fit on live-token protocols, held-out test, cross-validation, bootstrap) and
// the farm-plan generator. Nothing here names a protocol: every figure comes from the snapshot's own fields.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RadarEngine = api;
})(this, function () {
  'use strict';

  var DAY = 86400000;
  var GROWTH_MIN = -50, GROWTH_MAX = 100; // per cent: the clamp on seven-day TVL change
  var LAMBDAS = [0.1, 0.3, 1, 3, 10, 30, 100, 300];
  // Feature order: 0 log10 TVL, 1 growth, 2 log2 age, 3 age unknown, 4..7 category group dummies.
  var GROUPS = ['credit', 'dex', 'vault', 'rwa']; // derivatives (4 comparables) and the rest fall into 'other'
  var NAMES = ['log10 TVL', '7d growth', 'log2 age', 'age unknown'].concat(GROUPS.map(function (g) { return 'group ' + g; }));
  var ABLATIONS = [
    { id: 'tvl', label: 'TVL only', cols: [0] },
    { id: 'tvl+growth', label: 'TVL + growth', cols: [0, 1] },
    { id: 'tvl+age', label: 'TVL + age', cols: [0, 2, 3] },
    { id: 'tvl+group', label: 'TVL + category group', cols: [0, 4, 5, 6, 7] },
    { id: 'full', label: 'All terms', cols: [0, 1, 2, 3, 4, 5, 6, 7] }
  ];

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

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

  /** Deterministic generator (a 32-bit linear congruential sequence): same seed, same numbers, any machine. */
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
    var n = X.length, k = cols.length, i, j, a;
    var mean = [], sd = [];
    for (j = 0; j < k; j++) {
      var m = 0, v = 0;
      for (i = 0; i < n; i++) m += X[i][cols[j]];
      m /= n;
      for (i = 0; i < n; i++) v += Math.pow(X[i][cols[j]] - m, 2);
      mean.push(m); sd.push(Math.sqrt(v / n) || 1);
    }
    var ybar = 0;
    for (i = 0; i < n; i++) ybar += y[i];
    ybar /= n;
    var A = [], b = [];
    for (a = 0; a < k; a++) { A.push(new Array(k).fill(0)); b.push(0); }
    for (i = 0; i < n; i++) {
      for (a = 0; a < k; a++) {
        var za = (X[i][cols[a]] - mean[a]) / sd[a];
        b[a] += za * (y[i] - ybar);
        for (j = 0; j < k; j++) A[a][j] += za * ((X[i][cols[j]] - mean[j]) / sd[j]);
      }
    }
    for (a = 0; a < k; a++) A[a][a] += lambda;
    var ws = solve(A, b), w = new Array(8).fill(0), icpt = ybar;
    for (a = 0; a < k; a++) { w[cols[a]] = ws[a] / sd[a]; icpt -= w[cols[a]] * mean[a]; }
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

  function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }

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

  function chooseLambda(X, y, cols, seed) {
    var best = LAMBDAS[0], bestErr = Infinity;
    LAMBDAS.forEach(function (l) {
      var oof = crossValidate(X, y, cols, l, 4, 8, seed), err = 0;
      for (var i = 0; i < y.length; i++) err += Math.pow(y[i] - oof[i], 2);
      if (err < bestErr) { bestErr = err; best = l; }
    });
    return best;
  }

  /** Natural-unit reading of a fit: elasticity, growth per +10 points, factor per doubling of age, group factors. */
  function terms(model) {
    return [
      { id: 'tvl', label: 'TVL elasticity (exponent on TVL)', value: model.w[0] },
      { id: 'growth', label: 'Factor per +10 points of 7d growth', value: Math.pow(10, model.w[1] * 0.1) },
      { id: 'age', label: 'Factor per doubling of age', value: Math.pow(10, model.w[2]) },
      { id: 'unknown', label: 'Factor when age is unknown', value: Math.pow(10, model.w[3]) }
    ].concat(GROUPS.map(function (g, i) { return { id: 'g_' + g, label: 'Factor, ' + g + ' vs other', value: Math.pow(10, model.w[4 + i]) }; }));
  }

  /**
   * The whole fit. train: snapshot entries with a market cap. Steps: a hash split holds out a quarter; lambda is
   * chosen by cross-validation on the other three quarters; the held-out quarter is scored once; the shipped model
   * is refit on everything; bootstrap resamples give each term an interval; out-of-fold residuals give the bands.
   */
  function fitValueModel(train, asOf) {
    var X = train.map(function (p) { return features(p, asOf); });
    var y = train.map(function (p) { return Math.log10(p.mcap_usd / 1e7); });
    var n = y.length, i, full = ABLATIONS[ABLATIONS.length - 1].cols;
    var trainIdx = [], testIdx = [];
    train.forEach(function (p, q) { (fnv(p.slug) % 4 === 0 ? testIdx : trainIdx).push(q); });
    var Xa = trainIdx.map(function (q) { return X[q]; }), ya = trainIdx.map(function (q) { return y[q]; });
    var Xt = testIdx.map(function (q) { return X[q]; }), yt = testIdx.map(function (q) { return y[q]; });
    var baseTrain = mean(ya);
    var heldOut = {};
    ABLATIONS.forEach(function (ab) {
      var lam = chooseLambda(Xa, ya, ab.cols, 101);
      var m = fitRidge(Xa, ya, ab.cols, lam);
      heldOut[ab.id] = metrics(yt, Xt.map(function (f) { return predictLog(m, f); }), baseTrain);
      heldOut[ab.id].lambda = lam;
    });
    // The constant-multiple baseline: every protocol gets the training median market cap.
    var sortedTrain = ya.slice().sort(function (p, q) { return p - q; });
    var medianBase = metrics(yt, yt.map(function () { return quantile(sortedTrain, 0.5); }), baseTrain);

    var cvAll = {};
    var oofFull = null;
    ABLATIONS.forEach(function (ab) {
      var lam = chooseLambda(X, y, ab.cols, 202);
      var oof = crossValidate(X, y, ab.cols, lam, 20, 10, 303);
      cvAll[ab.id] = metrics(y, oof, mean(y));
      cvAll[ab.id].lambda = lam;
      if (ab.id === 'full') oofFull = oof;
    });
    var lambda = cvAll.full.lambda;
    var model = fitRidge(X, y, full, lambda);

    var boots = [], rnd = lcg(404), b, ids;
    for (b = 0; b < 200; b++) {
      ids = [];
      for (i = 0; i < n; i++) ids.push(Math.floor(rnd() * n));
      boots.push(terms(fitRidge(ids.map(function (q) { return X[q]; }), ids.map(function (q) { return y[q]; }), full, lambda)));
    }
    var shipped = terms(model).map(function (t, j) {
      var vals = boots.map(function (bt) { return bt[j].value; }).sort(function (p, q) { return p - q; });
      return { id: t.id, label: t.label, value: t.value, lo: quantile(vals, 0.05), hi: quantile(vals, 0.95) };
    });
    var res = oofFull.map(function (o, q) { return y[q] - o; }).sort(function (p, q) { return p - q; });
    var band = { q10: quantile(res, 0.1), q25: quantile(res, 0.25), q75: quantile(res, 0.75), q90: quantile(res, 0.9) };
    var mHeld = fitRidge(Xa, ya, full, heldOut.full.lambda);
    var inBand = yt.filter(function (v, q) { var e = v - predictLog(mHeld, Xt[q]); return e >= band.q25 && e <= band.q75; }).length / yt.length;
    return {
      n: n, n_fit: trainIdx.length, n_test: testIdx.length, lambda: lambda, intercept: model.intercept, w: model.w,
      terms: shipped, band: band, held_out: heldOut, cross_validated: cvAll, baseline_median: medianBase,
      test_in_50_band: inBand, labels: ABLATIONS.map(function (a) { return { id: a.id, label: a.label }; }),
      oof: train.map(function (p, q) { return { slug: p.slug, actual: p.mcap_usd, predicted: Math.round(Math.pow(10, oofFull[q]) * 1e7), test: testIdx.indexOf(q) >= 0 }; })
    };
  }

  /** A protocol's implied value: the model's typical (median) market cap in dollars, with its 50% and 80% range. */
  function impliedValue(model, p, asOf) {
    var f = features(p, asOf), lg = predictLog(model, f), at = function (e) { return Math.max(1, Math.round(Math.pow(10, lg + e) * 1e7)); };
    return { value: at(0), lo50: at(model.band.q25), hi50: at(model.band.q75), lo80: at(model.band.q10), hi80: at(model.band.q90),
      parts: { tvl: model.w[0] * f[0], growth: model.w[1] * f[1], age: model.w[2] * f[2] + model.w[3] * f[3], group: f.slice(4).reduce(function (s, v, j) { return s + v * model.w[4 + j]; }, 0) } };
  }

  // ---- farm plans -------------------------------------------------------------------------------------------
  // Gas per transaction in dollars is a rough assumption about each chain's usual fee, not a snapshot figure.
  var GAS = { Ethereum: 6, Bitcoin: 3, Tron: 0.8, Solana: 0.02 };
  var CHEAP = /Arbitrum|Base|Optimism|OP Mainnet|Polygon|Linea|Scroll|zkSync|Blast|Mantle|Mode|Sonic|Berachain|Unichain|Ink|Avalanche|Binance|BSC|Plasma|Hyperliquid|Sei|Sui|Aptos|TON|Near|Cronos|Gnosis|xDai/i;
  function gasFor(chain) {
    if (GAS[chain] !== undefined) return GAS[chain];
    return CHEAP.test(chain) ? 0.12 : 0.3;
  }

  function kindOf(category) {
    var c = (category || '').toLowerCase();
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

  var KINDS = {
    credit: ['Supply stablecoins to the largest lending market, then borrow a small amount against them', 'Repay part of the loan and withdraw part of the supply so both directions are on record'],
    cdp: ['Deposit collateral and mint a small amount of the protocol stable asset at a very safe collateral ratio', 'Move the minted stable asset into the protocol\'s own savings or pool product'],
    dex: ['Swap through the main pair a few times at different sizes', 'Add liquidity to the deepest pool and keep the LP position open'],
    lp: ['Deposit into the managed liquidity vault with the highest TVL', 'Withdraw a slice, redeposit it, and compound once if the app offers it'],
    vault: ['Deposit stablecoins into the vault with the most TVL and keep the vault shares', 'Add a second deposit into a different vault so two strategies are on record'],
    yield: ['Deposit stablecoins into the main yield product and keep the receipt token', 'Use the receipt token inside the protocol\'s own second product, such as a boosted pool or a lock'],
    rwa: ['Complete the protocol\'s onboarding if it asks, then buy a small amount of its yield-bearing token', 'Hold it in the same wallet and try one redemption request for a small slice'],
    perp: ['Deposit margin and open one small, low-leverage position', 'Close it, then open one on a second market so volume comes from two venues'],
    stake: ['Stake or restake the chain\'s main asset through the protocol and keep the receipt token', 'Delegate or allocate the receipt token to a second operator or pool if the app allows it'],
    bridge: ['Bridge a small amount of a stable asset in through the protocol', 'Bridge a slice back out, so both directions are on record'],
    cover: ['Buy a small policy or deposit into its underwriting pool', 'Extend or renew the position once before the first window ends'],
    predict: ['Fund the account and place a small position in a liquid market', 'Place a second position in a different market and close one of them early'],
    pay: ['Create the account or card, load a small balance, and make one real payment', 'Make a second payment on another day and top up once'],
    other: ['Deposit a small amount into the protocol\'s main product and keep the receipt', 'Try the second most used feature in the app once']
  };

  /** Round up to a tidy dollar figure. */
  function nice(v) { return v < 10 ? '$' + v.toFixed(2) : '$' + Math.round(v); }

  /**
   * One protocol's farm plan: eight steps, each with its cost and time, and totals. Chain, category, TVL, age and
   * seven-day growth choose the action, the hold, the capital and the exit trigger; no name is special-cased.
   */
  function farmPlan(p, ctx) {
    var chain = p.chains.length > 0 ? p.chains[0] : 'its main chain', gas = gasFor(chain);
    var age = ageDays(ctx.asOf, p.listed_at), kind = kindOf(p.category), acts = KINDS[kind];
    var hold = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
    var weeks = Math.ceil(hold / 7), txs = 6 + weeks;
    var gasTotal = Math.round(txs * gas * 100) / 100;
    var capital = clamp(Math.ceil(gasTotal / 0.04 / 50) * 50, 100, 2000);
    var growth = typeof p.change_7d === 'number' ? p.change_7d : null;
    var hours = Math.round((0.33 + 0.25 + 0.4 + 0.3 + weeks * 0.15 + 0.2 + 0.2) * 10) / 10;
    var trigger = growth !== null && growth < -10 ? 'TVL falls 15% from your entry reading (it already fell ' + Math.abs(growth).toFixed(1) + '% this week, so the trigger is tight)' : 'TVL falls 25% from your entry reading';
    var steps = [
      { t: 'Open defillama.com/protocol/' + p.slug + ' and the protocol\'s own site, check that it still shows no token and look for a points page or campaign. Save the official domain.', c: '$0', m: '20 minutes' },
      { t: 'Make a fresh wallet that holds only the farm funds, then put in ' + nice(capital) + ' plus ' + nice(gasTotal) + ' for gas on ' + chain + '. Keep the seed phrase offline.', c: nice(gas * 2) + ' of gas to fund it', m: '15 minutes' },
      { t: acts[0] + ' on ' + chain + ', using ' + nice(capital) + ' as the position.', c: nice(gas * 2) + ' of gas, ' + nice(capital) + ' locked', m: '25 minutes' },
      { t: acts[1] + '. Two different actions on record look more like real use than one.', c: nice(gas * 2) + ' of gas', m: '20 minutes' },
      { t: 'Repeat one small action every week for ' + weeks + ' weeks, such as adding to the position, a swap or a vote, spread over different days.', c: nice(gas * weeks) + ' of gas in all', m: weeks * 9 + ' minutes in all' },
      { t: 'Hold the position for ' + hold + ' days' + (age === null ? ' (its age is unknown, so the shortest window)' : age < 180 ? ' (it is ' + age + ' days old with no token, so the longest window)' : ' (it has run ' + age + ' days with no token)') + '; a snapshot can land at any time.', c: nice(capital) + ' stays locked', m: hold + ' days' },
      { t: 'Check TVL weekly on its DefiLlama page and withdraw if ' + trigger + ', or if the site or contracts change without notice.', c: '$0 to check, ' + nice(gas * 2) + ' of gas to exit', m: '5 minutes a week' },
      { t: 'When a claim opens, use only the link on the official site, never a link sent to you, and sign nothing that asks for approval of all tokens.', c: '$0, and never pay to claim', m: '15 minutes' }
    ].map(function (s) {
      var text = s.t + ' Cost: ' + s.c + '. Time: ' + s.m + '.';
      return { text: text.length > 600 ? text.slice(0, 596) + '...' : text, t: s.t, c: s.c, m: s.m };
    });
    return { steps: steps, kind: kind, chain: chain, capital: capital, gas: gasTotal, hold_days: hold, hours: hours };
  }

  return { features: features, fitValueModel: fitValueModel, impliedValue: impliedValue, farmPlan: farmPlan, groupOf: groupOf, kindOf: kindOf, ageDays: ageDays, terms: terms, NAMES: NAMES, ABLATIONS: ABLATIONS, GAS: GAS };
});
