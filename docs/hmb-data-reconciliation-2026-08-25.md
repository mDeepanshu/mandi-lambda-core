# hmb Data Reconciliation — Phase 2

Run 2026-08-25 against the live hmb Supabase project. Read-only.

## Dataset

| Table | Rows |
|---|---|
| party | 761 (61 kisan, 700 vyapari) |
| items | 59 |
| device_details | 14 |
| auction | 3,220 |
| auction_transaction | 16,409 |
| vasuli | 4,902 |
| vyapari_bill | 6 |
| kisan_bill / kisan_bill_item | 0 |
| crate / crate_transaction | 0 |

Activity window: 2026-03-02 → 2026-08-23. Legacy load landed 2026-07-20/21, so
March–July rows are imported history and August rows are live traffic.

`kisan_bill` and `crate` are empty — those features have no prod history, so the
cutover cannot be validated against real bills for them.

## 1. Referential integrity — CLEAN

Zero orphans on every FK checked (`auction_transaction`→`auction`,
`auction_transaction`→`party`, `auction`→`party`, `auction`→`items`,
`vasuli`→`party`). Zero NULLs in the formula inputs (`rate`, `quantity`, `bag`,
`chungi`, `vyapari_id`). `chungi` is genuinely populated: 16,406 of 16,409 rows
have `chungi > 0`.

## 2. Formula choice — CONFIRMED CORRECT

Recomputing every vyapari's balance from transactions and comparing to the
stored `party.owed_amount`:

| Formula | Vyaparis matching within ₹1 |
|---|---|
| **hmb** `rate*qty + chungi*bag` | **311** |
| his/dev `(rate+chungi)*qty` | 47 |

The hmb variant fits 6.6× better. The `hmb-formula-is-different` split is right
and must be preserved.

## 3. Balance reconciliation — ₹26.5L unexplained

| | |
|---|---|
| SUM stored `owed_amount` | ₹30,58,762.28 |
| SUM computed from txns | ₹4,09,488.11 |
| **Difference** | **₹26,49,274.17** |
| Vyaparis matching (±₹1) | 311 |
| Vyaparis mismatched | 351 |

### Breakdown of the gap

| Bucket | Count | Sum(gap) |
|---|---|---|
| Dormant, carried balance (no txns at all, owed≠0) | 28 | ₹6,20,593 |
| Has vasuli but NO auction txn | 36 | ₹1,84,162 |
| Has auctions, still mismatched | 291 | ₹18,45,053 |

### Opening balances explain most, but not all

Match rate by cohort:

| First activity | Vyaparis | Mismatched | Match rate |
|---|---|---|---|
| March 2026 (legacy import) | 451 | 279 | 38% |
| April 2026 or later (post-cutover) | 178 | 44 | **75%** |

The legacy cohort reconciles far worse than the post-cutover cohort — the
signature of carried-forward opening balances that were never imported as
transactions. That is expected and benign.

**But 44 post-cutover vyaparis, who cannot have legacy history, still do not
reconcile.** That residue is the real finding. Largest:

| Vyapari | 1st activity | Owed | Debit | Credit | txn a/v | Gap |
|---|---|---|---|---|---|---|
| SAHEED BATU MANDI | 2026-04-08 | 113,886 | 64,040 | 49,345 | 42/20 | 99,191 |
| MUSTAKEEM YUSUF MAND | 2026-08-12 | 24,797 | 440 | 410 | 2/1 | 24,767 |
| RUPA SINDI MANDI | 2026-04-01 | 6,362 | 2,810 | 20,000 | 2/2 | 23,552 |
| SUNNY KHATEEK KACHOR | 2026-04-13 | 2,150 | 0 | 9,500 | 0/3 | 11,650 |

Note MUSTAKEEM: first activity **2026-08-12**, well after the legacy load, with
2 auction txns and 1 vasuli — and a ₹24,767 gap. No opening balance can explain
that one.

### Secondary signal

- 36 vyaparis have vasuli payments but **zero** auction transactions; 12 of them
  still show `owed_amount > 0`. Payments recorded against traders who never
  bought anything in this DB.
- 32 vyaparis have **negative** `owed_amount` (overpaid). `owed_amount` is not
  clamped at zero, so double-applied credits would go undetected.

## Verdict — NOT yet a pass

Schema and referential integrity are production-ready and the formula choice is
confirmed. The balance reconciliation is **not** clean enough to gate a cutover:
the bulk is explained by un-imported opening balances, but a post-cutover residue
of 44 vyaparis is not, and at least one of those has no legacy explanation at all.

## Recommended next steps

1. **Decide how opening balances are represented.** They exist in
   `owed_amount` but not as transactions, so any ledger screen that recomputes
   from transactions will disagree with the stored balance for 451 traders.
   Either import them as dated opening-balance rows, or accept that the ledger
   and the balance are different numbers and make the UI say so.
2. **Investigate the 44 post-cutover mismatches**, starting with MUSTAKEEM
   YUSUF MAND (Aug-12 first activity, ₹24,767 gap) — smallest dataset, cleanest
   test case. Pull its 2 auction txns and 1 vasuli and hand-verify.
3. **Explain the 36 vasuli-without-auction traders** — legitimate advance
   payments, or mis-keyed vyapari ids?
4. **Confirm whether negative `owed_amount` is intended.**
5. The five-bill acceptance gate from the migration plan **cannot be run**:
   `kisan_bill` is empty on hmb. Substitute vyapari ledger spot-checks against
   the old server's printed statements.
