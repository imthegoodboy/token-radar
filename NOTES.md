# Design notes

The snapshot says nothing about what a token would be worth, so the radar borrows values from protocols that already
trade. `dashboard/engine.js` fits log market cap on log TVL, capped 7-day growth, log age, an age-unknown flag and four
category groups (ridge regression, penalty chosen by cross-validation) over the 92 live tokens of original protocols.

Testing is stated on the page: a slug-hash split holds out 24 protocols that never touch the choice of penalty; 20
repeats of 10-fold cross-validation; 200 bootstrap refits for each term's interval; ablations from TVL alone to all terms.
The result is weak (held-out R2 about 0.15, typical error about x3) and the page says so. Growth and category do not
beat TVL alone on held-out error; they stay in because the radar is asked about them.

Rows are the watchlist plus every other protocol that records no token and passes the watchlist's own rule (not versioned,
wrapped, staked, bridged or exchange). Live-token protocols are shown separately with the model's out-of-fold estimate.
Farm plans come from `farmPlan` in the same file: category picks the actions, the first listed chain sets gas, TVL and
gas set capital, age sets the hold, 7-day growth sets the exit trigger. Gas per transaction is a stated assumption.

One engine file serves main.ts (which writes board.json) and the page (which re-fits and recomputes), so the page's
numbers and the board's are the same arithmetic. Run `node --test test/radar.test.ts` for the tests.
