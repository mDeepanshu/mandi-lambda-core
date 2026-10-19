# DB Parity Audit — dev / his / hmb

Run 2026-08-24 against all three Supabase projects via the `.env` connection
strings. Phase 1 of the prod migration plan. Postgres 17.6, 52 public functions
on every stage.

## Method

RPC names extracted from `src/**/*.ts` with a **multiline** grep:

```bash
grep -rhozoE "rpc\(\s*'[a-z_]+'" src --include=*.ts | tr '\0' '\n' \
  | grep -oE "'[a-z_]+'" | tr -d "'" | sort -u
```

A single-line `grep -rhoE "rpc\('[a-z_]+'"` **under-reports by 5** — several
callers wrap the name onto the next line. 41 RPCs are called, not 36.

Bodies compared by `md5(prosrc)`, keyed on `proname + identity_arguments` so
overloads compare correctly. Every difference found was then diffed line by line.

## 1. Missing RPCs — 7, on ALL three stages

| RPC | Caller | Broken endpoint |
|---|---|---|
| `save_kisan_bill` | `src/bill/bill.repo.ts:7` | `/bills` save kisan bill |
| `get_kisan_bill_by_kisan_id_and_date` | `src/bill/bill.repo.ts:21` | `/bills` previous kisan bill |
| `save_vyapari_bill` | `src/bill/bill.repo.ts:34` | `/bills` save vyapari bill |
| `get_vyapari_bill_by_vyapari_id_and_date` | `src/bill/bill.repo.ts:48` | `/bills` previous vyapari bill |
| `auto_save_bills` | `src/bill/bill.repo.ts:61` | `/bills` autoSaveBills |
| `list_vyapari_ledger_all` | `src/vyapari/vyapari.repo.ts:73` | `GET /vyapari/ledger-list-all-vyapari` |
| `pending_items_summary` | `src/kisan/kisan.repo.ts:53` | `GET /kisan/PendingItemsSummary` |

**The entire `/bills` lambda has never worked on any stage** — all five of its
RPCs are absent. No `db/*.sql` exists for any of the seven, so there is nothing
to port; they must be written from scratch.

`tests/api/08-contract-mismatches.test.ts` pins these as expected-500s.

**Decision required before cutover:** is `/bills` in scope? If yes, seven
functions must be authored and the pinned tests flipped. If no, say so
explicitly and confirm the frontend does not call these routes in prod.

## 2. Formula divergence — 14 functions, verified correct

hmb genuinely differs from dev/his. Every one of the 14 was diffed line by line
and the ONLY difference is the chungi formula (plus `bag` added to `RETURNING`
where hmb needs it). **No accidental drift. Do not reconcile these.**

- dev + his: `(rate + chungi) * quantity`
- hmb: `rate * quantity + COALESCE(chungi,0) * COALESCE(bag,0)`

Called by current code (7): `create_auction_bulk`,
`create_auction_bulk_with_crate`, `edit_auction_transaction`,
`find_ledger_transactions`, `find_ledger_transactions_list`,
`delete_auction_transactions`, `generate_auction_ledger`.

Uncalled legacy, same formula (7): `add_auction`, `edit_auction_by_recreate`,
`edit_auction_by_recreate2`, `find_vyapari_closing_amount_on_date`,
`find_vyapari_closing_amount_on_date_list`, `get_auction_transactions_report2`,
`get_auction_transactions_report3`.

The remaining 27 called RPCs are byte-identical across all three stages, and
signatures match everywhere. No function exists on one stage but not another.

## 3. Schema migrations — all applied on hmb

| Object | dev | his | hmb |
|---|---|---|---|
| `auction_transaction.created_at` | ok | ok | ok |
| `crate_transaction.created_at` | ok | ok | ok |
| `crate_transaction.txn_type` | ok | ok | ok |
| `crate_transaction.parent_id` | ok | ok | ok |
| `crate_transaction_log` | ok | ok | ok |
| `kisan_bill_pending_stock` | ok | ok | ok |
| `tts_clip` | ok | ok | ok |

Everything in `db/` postdating the hmb legacy load is present on all stages.

## 4. TTS already seeded

`tts_clip` holds **109 rows on all three stages, hmb included** — migration and
seed are both done. Outstanding: the `tts` Lambda is not deployed, and the old
Sarvam key (previously public in the frontend bundle) still needs rotating.

## Phase 1 verdict

The databases are in good shape. Schema parity is perfect, the hmb formula split
is correct and intentional, TTS is seeded. The single blocking item is the
`/bills` scope decision.

## Scope decision (2026-08-25)

`/bills` is **out of scope** for the prod migration. `src/bill` is fully
self-contained — nothing outside it imports from it — so the five bill RPCs
stay unwritten and the `bill` lambda ships dead (or is not deployed at all).

The two non-bill dead routes are **also out of scope**:

| Route | Module | Missing RPC |
|---|---|---|
| `GET /vyapari/ledger-list-all-vyapari` | `src/vyapari` | `list_vyapari_ledger_all` |
| `GET /kisan/PendingItemsSummary` | `src/kisan` | `pending_items_summary` |

These sit inside lambdas that ARE shipping, so they will return 500 in prod.
`tests/api/08-contract-mismatches.test.ts` keeps them pinned as expected-500s.

**Open follow-up before cutover:** confirm the prod frontend does not call these
two routes. A 500 in a shipping lambda is user-visible, unlike the bill lambda
which can simply not be deployed.
