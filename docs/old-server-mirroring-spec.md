# Old-Server → Lambda API Mirroring Spec

Integration contract for mirroring writes from the old backend to the lambda API
during the migration monitoring period. Verified against the deployed code and
the actual RPC definitions in the his database (2026-07-11).

## Base URLs

| Stage | Base URL |
|---|---|
| his | `https://nci05m4mhf.execute-api.ap-south-1.amazonaws.com` |
| hmb | `https://fkli4fih7l.execute-api.ap-south-1.amazonaws.com` |

his and hmb are different clients — never send one client's data to the other.

## Response envelope (all endpoints)

```json
{ "responseCode": "200", "responseMessage": "Success", "responseBody": <data> }
```

- `200`/`201` = success. `400` = validation or FK problem, `responseBody` has details.
- `500` = `"Something Went Wrong"` with details hidden; the real error is in
  CloudWatch log group `/aws/lambda/mandi-lambda-core-{stage}-{function}`.
- Server-to-server calls need no Origin/CORS headers. All requests need
  `content-type: application/json`.

## Data readiness — load BEFORE mirroring starts

| Master data | his | hmb |
|---|---|---|
| `party` | ✅ loaded (869 rows, old ids) | ❌ pending |
| `items` | ❌ pending | ❌ pending |
| `device_details` | ❌ pending (needed for auctions) | ❌ pending |
| `crate` | ✅ n/a — lambda-native, client manages it | n/a |

Until items/devices are loaded, `POST /auction` fails its FK checks on that
stage. `POST /party/vasuliTrasaction` only needs `party`, so his can mirror
payments already.

## Fixes applied 2026-07-11 (context, all verified end-to-end)

1. `delete_auction_transactions` and `mark_transaction_validated` DB functions
   were missing everywhere (endpoints 8 and 9 returned 500 unconditionally);
   both created in dev/his/hmb, SQL versioned in `db/`.
2. `insert_vasuli` now decrements `party.owed_amount`; `edit_vasuli` adjusts it
   on amount changes and vyapari reassignment (`db/vasuli_owed_amount.sql`).
3. `POST /party/vasuliTrasaction` previously processed only the first array
   element; now the whole array, atomically, returning one id per payment.
4. The owed/amount formula was inconsistent and wrong per client; now
   client-specific everywhere (see the formula table in endpoint 5):
   his/dev `(rate + chungi) × quantity`, hmb `rate × quantity + chungi × bag`
   (`db/chungi_formula_his.sql`, `db/chungi_formula_hmb.sql`).

## Ordering rules

1. Masters before transactions: party → item → auction/vasuli. An auction or
   vasuli referencing an unknown `party_id`/`item_id` fails its FK check.
2. Send the OLD SERVER'S NATIVE IDS as `partyId` / `itemId` when creating
   parties and items. This is what keeps the two systems joinable — the his DB
   was seeded with the old system's own party ids.
3. `deviceid` (for auctions) must be a device already registered in
   `device_details` on that stage (devices register via `POST /device/register`
   from the new app; the old server just passes a valid numeric id).

---

## 1. POST /party  (create party)

Body: **array** of parties (batch OK).

| JSON field | Required | Notes |
|---|---|---|
| `partyId` | effectively yes | old server's native party id. Omitting it inserts a NULL PK → error. camelCase only — `party_id` passes validation but is IGNORED by the mapper |
| `name` | yes | |
| `contact` | yes | |
| `partyType` | yes | EXACT string `"KISAN"` or `"VYAPARI"`. Anything else (including `"0"`/`"1"`) silently becomes VYAPARI |
| `owedAmount` | no | number |
| `maxLoanDays` | no | number |
| `ledgerOrder` | no | number |
| `partyCode` | no | string |

Not settable here: `kisan_type` (defaults `'A'`), `commission_rate` (DB
default), `id_no` (auto-sequence). If the old server tracks per-party
commission, that cannot be mirrored through this endpoint today.

```bash
curl "$BASE/party" -H 'content-type: application/json' --data-raw '[
  { "partyId": "641", "name": "NEW VYAPARI", "contact": "9876543210",
    "partyType": "VYAPARI", "owedAmount": 0, "maxLoanDays": 5, "partyCode": "123456" }
]'
```

Response `201`, `responseBody` = array of inserted `party` rows (snake_case
columns, includes assigned `id_no`).

## 2. PATCH /party  (edit party)

Body: **single object** (not array).

| JSON field | Required | Notes |
|---|---|---|
| `id` | yes | the `party_id` |
| `name` | yes | always sent, even if unchanged |
| `contact` | yes | always sent, even if unchanged |
| `maxLoanDays` | no | omitted fields stay unchanged |
| `ledgerOrder` | no | |
| `lastNotifiedAmount` | no | |
| `partyCode` | no | |

Cannot update: `owed_amount`, `party_type`, `kisan_type`, `commission_rate`.

```bash
curl -X PATCH "$BASE/party" -H 'content-type: application/json' --data-raw \
  '{ "id": "641", "name": "NEW VYAPARI RENAMED", "contact": "9876543210", "maxLoanDays": 7 }'
```

Response `200`, `responseBody` = updated party row.

## 3. POST /party/vasuliTrasaction  (record payments)

Route has a typo — it really is `vasuliTrasaction` (missing "n").
Body: array — every element is processed atomically (all payments insert and
all owed amounts update, or the whole request fails). Each payment decrements
its vyapari's `owed_amount`.

| JSON field | Required | Notes |
|---|---|---|
| `vyapariId` | yes | `party_id` of the payer |
| `date` | yes | timestamp string, e.g. `"2026-07-11 18:30:00"` or `"2026-07-11"` |
| `amount` | yes | number |
| `remark` | no | |
| `was_null` | no | boolean (snake_case here, unlike everywhere else) |

Optional query `?confirmDuplicate=true`: currently just swallows errors on the
lambda side (no real duplicate detection in the DB function) — do not rely on it.

```bash
curl "$BASE/party/vasuliTrasaction" -H 'content-type: application/json' --data-raw '[
  { "vyapariId": "102", "date": "2026-07-11 18:30:00", "amount": 5000, "remark": "cash" },
  { "vyapariId": "100", "date": "2026-07-11 18:31:00", "amount": 3200 }
]'
```

Response `200`, `responseBody` = one entry per payment, in request order:

```json
[
  { "id": "<uuid>", "vyapariId": "102", "amount": 5000 },
  { "id": "<uuid>", "vyapariId": "100", "amount": 3200 }
]
```

**STORE EACH `id`** against the old server's payment record — it is the `id`
required by `PUT /vyapari/edit-vasuli`. There is no other way to look it up
reliably later.

## 4. PUT /vyapari/edit-vasuli  (edit payment)

Body: single object. Only `id` is required; omitted fields keep their values.

| JSON field | Required | Notes |
|---|---|---|
| `id` | yes | uuid returned by the vasuli insert |
| `amount` | no | number |
| `date` | no | timestamp string |
| `vyapariId` | no | reassign payment to another party |
| `remark` | no | |
| `wasNull` | no | boolean (camelCase here, unlike the insert) |

```bash
curl -X PUT "$BASE/vyapari/edit-vasuli" -H 'content-type: application/json' --data-raw \
  '{ "id": "<uuid-from-insert>", "amount": 4500 }'
```

Response `200`, `responseBody` = updated `vasuli` row.

`owed_amount` is adjusted automatically: an amount change applies the delta;
changing `vyapariId` restores the old vyapari's dues and reduces the new one's.

## 5. POST /auction  (create auctions)

Headers: `deviceid: <numeric>` — REQUIRED, must exist in `device_details`.
Body: **array** of auctions. Each auction creates one `auction` row, its
`auction_transaction` rows, crate movements, and increments each vyapari's
`owed_amount` — all atomically in one RPC.

**The owed/amount formula is client-specific** (applied consistently across
all create/edit/delete RPCs and every ledger/report in that stage's DB,
2026-07-11):

| Stage | Formula |
|---|---|
| his (and dev) | `(rate + chungi) × quantity` |
| hmb | `rate × quantity + chungi × bag` |

Because hmb's formula uses `bag`, the old server MUST send `bags` on every
buy item for hmb, or the chungi component silently becomes 0.

**⚠ The DB function reads different key names than the TypeScript validator
suggests. Use exactly these keys** (unknown keys pass through to the RPC):

Auction level:

| JSON field | Required | Notes |
|---|---|---|
| `kisanId` | yes | `party_id` of the farmer |
| `itemId` | no | must exist in `items` if sent |
| `total_bags` | no | **snake_case!** `bagTotal` passes validation but the RPC ignores it → column stays NULL |
| `auctionDate` | no | `"YYYY-MM-DD"`, sets `auction.auction_date` |
| `crate_id` | no | crate type issued to this kisan's buyers |
| `device_id` | no | **snake_case** per-auction override; camelCase `deviceId` is ignored; falls back to the `deviceid` header |
| `buyItems` | yes, min 1 | array, see below |

Per buy item:

| JSON field | Required | Notes |
|---|---|---|
| `vyapariId` | yes | buyer `party_id` |
| `rate` | no | numeric |
| `quantity` | no | numeric |
| `bags` | no | **plural!** the RPC reads `bags`; the singular `bag` is ignored → column NULL |
| `chungi` | no | defaults 0 |
| `crate_count` | no | crates issued to this buyer; rows written to `crate_transaction` only when > 0 (needs auction-level `crate_id`) |
| `auctionDate` | no | date used for the crate_transaction row |
| `bagWiseQuantity` | no | number array, stored comma-joined |

Note: `auction_transaction.auction_date` is set to NOW() by the RPC regardless
of payload — only `auction.auction_date` and crate dates honor `auctionDate`.

```bash
curl "$BASE/auction" -H 'content-type: application/json' -H 'deviceid: 1' --data-raw '[
  {
    "kisanId": "K10", "itemId": "1", "total_bags": 10,
    "auctionDate": "2026-07-11", "crate_id": 1,
    "buyItems": [
      { "vyapariId": "102", "rate": 550, "quantity": 25.5, "bags": 5,
        "chungi": 0, "crate_count": 5, "auctionDate": "2026-07-11",
        "bagWiseQuantity": [5.1, 5.1, 5.1, 5.1, 5.1] },
      { "vyapariId": "100", "rate": 540, "quantity": 26.0, "bags": 5 }
    ]
  }
]'
```

Response `200`, **`responseBody` = `true` — no ids are returned.**
To obtain the generated `auctionTransactionId`s (needed for edits/deletes),
call afterwards:

```
GET /auction/list-auction-transaction?startDate=2026-07-11&endDate=2026-07-11&deviceId=1
```

which returns transactions including `auctionTransactionId`, and match them to
old-server lots by (vyapariId, rate, quantity, order). Store the mapping
old-lot-id → auctionTransactionId on the old server.

## 6. PATCH /auction/edit-auction  (recreate an auction)

Headers: `deviceid: <numeric>` required.
Semantics: deletes the listed transactions, then re-adds the given auctions —
the RPC also reverses/reapplies `owed_amount`.

Body:

```json
{
  "deleteAuctionTransactionDto": { "auctionTransactionIds": ["<uuid>", "<uuid>"] },
  "addAuctionDtos": [ /* same objects as POST /auction body */ ]
}
```

Same key-name warnings as POST /auction apply to `addAuctionDtos`.
Response `200`, `responseBody` = `null`. The recreated transactions get NEW
uuids — re-run the list endpoint to refresh the id mapping.

## 7. POST /auction/edit-auction-transaction  (edit a single lot)

Body: single object — here ALL of these are required (unlike create), and the
key is singular `bag`:

| JSON field | Required | Notes |
|---|---|---|
| `auctionTransactionId` | yes | uuid |
| `vyapariId` | yes | may reassign the lot |
| `rate` | yes | number |
| `quantity` | yes | number |
| `bag` | yes | **singular** here (this path maps explicitly, unlike the create RPC) |
| `chungi` | yes | number |
| `bagWiseQuantity` | no | number array |

The RPC adjusts `owed_amount` for the change.

**⚠ The uuid CHANGES on every edit.** The RPC does not update the row in
place — it marks the old row as history (`is_old='Y'`) and inserts a
replacement row with a NEW `auctionTransactionId` (linked to the old one via
`parent_id`). After each edit the old server MUST refresh its lot-id mapping
(re-run `GET /auction/list-auction-transaction`), otherwise the next
edit/delete for that lot will target a dead id.

```bash
curl "$BASE/auction/edit-auction-transaction" -H 'content-type: application/json' --data-raw \
  '{ "auctionTransactionId": "<uuid>", "vyapariId": "102", "rate": 560,
     "quantity": 25.5, "bag": 5, "chungi": 0 }'
```

Response `200`, `responseBody` = `null` (the new id must be fetched via the
list endpoint).

## 8. DELETE /auction/delete-auction-transaction  (delete lots)

Body: `{ "auctionTransactionIds": ["<uuid>", ...] }`

Behavior (function `delete_auction_transactions`, installed in all stages):
deletes the transactions **plus their edit-history rows** (`is_old='Y'`
ancestors linked via `parent_id`), reverses each vyapari's `owed_amount`
using the stage's formula (his: `(rate + chungi) × quantity`; hmb:
`rate × quantity + chungi × bag`) counting ACTIVE rows only, and removes any
auction header left with zero transactions. Crate movements are NOT reversed
(consistent with the existing edit RPCs). Unknown/already-deleted uuids are
ignored (idempotent — returns success).

```bash
curl -X DELETE "$BASE/auction/delete-auction-transaction" \
  -H 'content-type: application/json' \
  --data-raw '{ "auctionTransactionIds": ["<uuid>"] }'
```

Response `200`, `responseBody` = `true`. Note some HTTP clients need explicit
support for DELETE-with-body.

## 9. PATCH /auction/mark-transaction-validated  (validation checkpoint)

No body; query string only (all three params required, dates `YYYY-MM-DD`):

```
PATCH /auction/mark-transaction-validated?fromDate=2026-07-01&toDate=2026-07-11&vyapariId=102
```

Sets `auction_transaction.validated = 'Y'` for that vyapari's transactions in
the date range (function `mark_transaction_validated`, installed in all
stages). This is a running reconciliation checkpoint per vyapari — it is what
`get_unvalidated_start_date` reads. Idempotent: already-validated rows are
skipped.

Response `200`, `responseBody` = number of rows newly marked (integer).

## 10. POST /item/createItem  (create items)

Body: **array**. Send the old server's native item id.

| JSON field | Required | Notes |
|---|---|---|
| `itemId` | effectively yes | old server's item id; omitting inserts NULL PK → error |
| `name` | yes | |

```bash
curl "$BASE/item/createItem" -H 'content-type: application/json' --data-raw \
  '[{ "itemId": "17", "name": "TAMATAR" }]'
```

Response `201`, `responseBody` = inserted `items` rows.

---

## Id-mapping table the old server must keep

| Lambda id | Obtained from | Needed for |
|---|---|---|
| `party_id` | you choose it (send native id on create) | everything |
| `item_id` | you choose it | auctions |
| vasuli `id` (uuid) | response of `POST /party/vasuliTrasaction` | `PUT /vyapari/edit-vasuli` |
| `auctionTransactionId` (uuid) | `GET /auction/list-auction-transaction` after create/edit | lot edit, lot delete, auction edit |
| `deviceid` | registered on the lambda side; agree on a fixed id for old-server mirroring | `POST /auction`, `PATCH /auction/edit-auction` |

## Monitoring during the mirror period

- Watch CloudWatch: `/aws/lambda/mandi-lambda-core-{his|hmb}-auction` and
  `-party` for ERROR entries (all 4xx/5xx causes are logged with details).
- Reconcile daily: old-server totals vs `GET /auction/generate-ledger` and
  `GET /vyapari/vasuli-list` per stage, plus spot-check `party.owed_amount`
  for a few active vyaparis (auctions increment it, vasuli decrements it).
