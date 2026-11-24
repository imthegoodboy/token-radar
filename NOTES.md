# Design notes

The snapshot says nothing about what a token would be worth, so the radar borrows values from protocols that already
trade. `dashboard/engine.js` fits log market cap by ridge regression on the live tokens of original protocols. Five term
sets (TVL alone up to TVL, 7-day growth, age and category group) times eight penalties are scored out of fold
(R2 plus rank correlation); the simplest set within 0.02 of the best score ships. The choice rule was fixed before the
held-out set was scored, and the page's Model tab prints every candidate, not just the winner.

Tests stated on the page: a slug-hash split holds out a quarter of the comparables; a time-ordered split fits on older
listings and tests on the newest quarter; both report R2, rank correlation, median error and how often the 50% and 80%
ranges held; 20 repeats of 10-fold cross-validation; 200 bootstrap refits for each term's interval. The result is weak
and the page says so. Neighbouring values on the board overlap within the typical error, so each row carries a rank
range instead of a false precise rank.

The numbers below are written by `node main.ts --notes NOTES.md` from the same fit that writes the page, never typed:

<!-- results -->
- Chosen model: TVL + age (ridge penalty 10), picked by cross-validation on 92 live tokens.
- Hash-split held-out (24 protocols): R2 0.17, rank correlation 0.39, median error x2.6; the same procedure on the fit side picked tvl+age.
- Time-ordered test (fit on older listings, test on the newest 18): R2 -0.00, rank correlation -0.21; 50% range held 50%, 80% range held 56%.
- Board: 198 rows (40 on the watchlist), 402 protocols that already trade, 158 excluded; verdicts: 39 farm, 59 thin, 100 skip.
<!-- /results -->

Rows are the watchlist plus every other protocol that records no token and passes the watchlist's own rule (not
versioned, wrapped, staked, bridged or exchange). Live-token protocols are shown separately with the model's out-of-fold
estimate.

Verdict (`netValue` in the engine): expected value = implied value x assumed airdrop share x your slice (capital x an
assumed active-user weight / TVL) x token odds; cost = capital x an assumed yearly rate x hold + gas (high end of an
assumed range) + hours x an assumed hourly value. Farm if expected value is at least twice the cost, thin if at least
once, else skip. Every assumption is printed on the Model tab with its value. Token odds are the share of original
protocols in the same age band and TVL band that already record a token (sample size shown), a proxy and not a forecast.

Farm plans (`lib/plans.ts`) are built per protocol category (fourteen kinds with their own steps, transactions, minutes,
risk and capital multiplier); the capital tier comes from TVL, the gas range from the first listed chain (an assumed range,
not a snapshot figure), the hold from age, the exit trigger from 7-day growth. Plans describe ordinary use of a protocol
by one person with one wallet.

One engine file serves main.ts (which writes board.json) and the page (which re-fits and recomputes), so the page's
numbers and the board's are the same arithmetic. Run `node --test test/radar.test.ts` for the tests.
