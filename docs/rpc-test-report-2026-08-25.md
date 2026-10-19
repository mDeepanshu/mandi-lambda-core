# Core Write-RPC Test Report

Tested 2026-08-25. Every test ran inside `BEGIN … ROLLBACK` against live dev and
hmb; verified afterwards that zero test rows leaked to either stage.

## Scope

| Endpoint | RPC |
|---|---|
| `POST /auction` | `create_auction_bulk_with_crate` |
| `POST /auction/edit-auction-transaction` | `edit_auction_transaction` |
| `PATCH /auction/edit-auction` | `edit_auction_by_recreate2` |
| `POST /party/vasuliTrasaction` | `insert_vasuli_bulk` → `insert_vasuli` |

Note `POST /auction` calls `create_auction_bulk_with_crate`, **not**
`create_auction_bulk` — the latter is dead code, commented out in
`auction.repo.ts:18`.

## Summary

| RPC | Verdict |
|---|---|
| `create_auction_bulk_with_crate` | PASS (1 minor) |
| `insert_vasuli_bulk` | PASS (2 minor) |
| `edit_auction_transaction` | **FAIL — money-corrupting** |
| `edit_auction_by_recreate2` | **FAIL — crate leak, device loss** |

---

## BUG 1 — `edit_auction_transaction` double-submit inflates owed_amount

**Severity: HIGH. Reachable through normal UI use. Reproduces on dev AND hmb.**

Submitting the *same* edit twice (double-click, retry, flaky network) applies the
delta twice.

```
create: qty 10, rate 10  -> owed 100
edit #1 (id t0): rate->20 -> owed 200   correct
edit #2 (id t0): rate->20 -> owed 300   WRONG, expected 200
```

Live rows afterwards: **1** — so the UI looks completely normal while the
balance is silently wrong by ₹100.

**Cause.** The RPC recomputes `old_amount` from the row identified by
`p_auction_transaction_id`. On the second call that row still holds the ORIGINAL
values (rate 10) because step 3 only sets `is_old='Y'`, it never updates the
amounts. So it subtracts the stale 100 and adds 200 again.

**Related, lower severity:** editing an already-superseded row is worse — it
leaves TWO rows with `is_old='N'` and produced ₹1190 where ₹400 was correct.
Exposure is limited because `get_auction_transactions_report3` filters
`is_old='N'`, so the UI does not normally hand out stale ids; a retry with a
cached id would still do it.

**Fix direction:** make the RPC idempotent — reject when the target row already
has `is_old='Y'`, i.e. `IF old_tx.is_old = 'Y' THEN RAISE EXCEPTION`. That
closes both the double-submit and the stale-row case. Needs applying to the
his/dev body AND the hmb body separately (see `hmb-formula-is-different`).

## BUG 2 — `edit_auction_by_recreate2` leaks crate rows

**Severity: HIGH for crate-using clients. Reproduces on dev AND hmb.**

The RPC deletes auction transactions and headers, then recreates via
`create_auction_bulk_with_crate` — but never deletes the `crate_transaction`
rows keyed to the old auction.

```
create: crate_count 5           -> 1 crate row,  total 5
recreate with crate_count 5     -> 2 crate rows, total 10   WRONG
```

The old row is **orphaned**: its `parent_id` points at an auction_id that no
longer exists. Verified 1 orphan after a single recreate.

hmb has 0 `crate_transaction` rows today, so no damage yet — but crate is a
live feature on his and the bug is in hmb's copy too, waiting.

**Fix direction:** delete `crate_transaction WHERE parent_id = ANY(deleted_auction_ids::text[])`
before step 5.

## BUG 3 — `edit_auction_by_recreate2` silently nulls device_id

**Severity: MEDIUM.**

`in_device_id := (new_payload->0->>'deviceId')::INTEGER` reads `deviceId` only
from the FIRST payload element, and only that spelling. If the key is absent the
recreated auction gets `device_id = NULL` with no error — the auction loses its
device attribution permanently.

Two aggravating details:
- `create_auction_bulk_with_crate` reads the per-row key `device_id`
  (snake_case), but this RPC writes `deviceId` (camelCase). Only the fallback
  parameter carries it through.
- A multi-auction payload where element 0 lacks `deviceId` nulls the device for
  ALL recreated auctions.

## Minor findings

**M1 — empty payload returns success.** `create_auction_bulk_with_crate('[]', n)`
returns `true` having done nothing. `POST /auction` with `[]` reports 200/created.
Worth a `.min(1)` in the Zod schema.

**M2 — negative vasuli amounts accepted, and INCREASE debt.**
`vasuliTransactionBodySchema` uses bare `z.coerce.number()` with no `.positive()`.
A `-50` payment moved owed_amount from -400 to -350. `createPartyBodySchema` has
`.min(1)`; the vasuli array schema does not, so `[]` also reaches the DB (raises
`payload cannot be empty` → surfaces as 500, not 400).

**M3 — owed_amount is never clamped at zero.** Overpaying drives it negative
(-400 in test). Consistent with the 32 negative balances found on hmb in the
Phase 2 reconciliation.

---

## What PASSED

`create_auction_bulk_with_crate` — 10/10 on the happy path: auction + txn rows,
owed math, crate issue, `bag_wise_quantity` joining, `auctionDate` honoured,
`validated`/`is_old` defaults. Multi-auction ordering is correct (the
`ROW_NUMBER() OVER ()` pairing held at 2 and at 12 auctions, though it is
unordered and only incidentally safe — worth an explicit `ORDER BY ord`).
Same-vyapari-twice-in-one-auction correctly pre-aggregates crates to one row.
FK violations on unknown kisan/vyapari/item reject cleanly. Missing `auctionDate`
falls back to **IST** (verified against server clock), so the timezone fix holds.

`edit_auction_transaction` — correct for its intended single-use path: same-vyapari
edits, vyapari reassignment (money moves fully, no leakage), reassign-back, and
3-deep chained edits all produced exact balances. `is_old` flagging, parent
linkage, and auction_date inheritance all correct.

`insert_vasuli_bulk` — the whole array is processed (the 2026-07-11 fix holds),
ids are distinct, dates preserved, `was_null` defaults false, owed_amount
decrements correctly per vyapari. **Atomicity confirmed:** a bad vyapari in
position 2 rolled back position 1 entirely — no partial writes.

`hmb formula variants` — verified live on hmb inside a rollback:
`rate*qty + chungi*bag` = 1010 where his would give 1200, and 2012 after an edit
changing both rate and bag. The client split is computing correctly.

## Recommended fix order before cutover

1. **BUG 1** — idempotency guard on `edit_auction_transaction` (both bodies).
   This one silently corrupts live balances today.
2. **BUG 2** — delete crate rows in `edit_auction_by_recreate2` (both bodies).
3. **BUG 3** — read `device_id`/`deviceId` per element, fail loudly if absent.
4. M1/M2 — Zod `.min(1)` and `.positive()` on the vasuli and auction schemas.
