# Crate APIs — Frontend Integration Guide

## Background / why these APIs exist

In the new Lambda backend, crate movements are recorded automatically as part of
`POST /auction`: the auction payload carries `crate_id` (per kisan auction) and
`crate_count` (per vyapari buy-item), and the DB procedure
`create_auction_bulk_with_crate` writes rows into the `crate_transaction` table.
Reports like `GET /crate/summary` are built on that table.

The current prod frontend does **not** use this backend yet, so no crate data is
being recorded. Until the full auction migration happens, the frontend should call
the two APIs below directly to keep `crate_transaction` populated. **Once the
frontend migrates to `POST /auction` on this backend, stop calling
`POST /crate/issue` for auction-driven crates — otherwise crates will be counted
twice.**

## Base URLs & environment mapping

All endpoints share the standard response envelope:

```json
{ "responseCode": "200", "responseMessage": "Success", "responseBody": ... }
```

The frontend must call a different backend stage depending on where it is
running:

| Frontend environment | Backend stage | Base URL |
|---|---|---|
| Local development | `dev` | `https://0n0mofjmxe.execute-api.ap-south-1.amazonaws.com` |
| Production | `his` | `https://nci05m4mhf.execute-api.ap-south-1.amazonaws.com` |

### New environment variable

Add a new env variable to the frontend that holds this backend's base URL, and
read every crate API call's base URL from it (adjust the prefix to your
framework — `VITE_`, `NEXT_PUBLIC_`, `REACT_APP_`, …):

```bash
# .env.local / .env.development  (local dev → dev stage)
VITE_MANDI_LAMBDA_API_URL=https://0n0mofjmxe.execute-api.ap-south-1.amazonaws.com

# .env.production  (deployed prod → his stage)
VITE_MANDI_LAMBDA_API_URL=https://nci05m4mhf.execute-api.ap-south-1.amazonaws.com
```

```js
const MANDI_LAMBDA_API_URL = import.meta.env.VITE_MANDI_LAMBDA_API_URL;

await fetch(`${MANDI_LAMBDA_API_URL}/crate/issue`, { method: 'POST', ... });
```

Do **not** hardcode the URLs in components — the prod frontend will later be
pointed at a different stage (`hmb`) during the full migration, and that must be
a config-only change.

No auth headers are required.

### ⚠️ CORS on the `his` stage

The `his` stage only allows these origins (configured in the backend's
`serverless.ts`):

- `https://cratehis.make73.com`
- `https://hiskisanbill.make73.com`
- `https://mandiauction.make73.com` ← the prod frontend

The `dev` stage allows `*`, so local development works from any port. If the
prod frontend ever moves to a different domain, tell the backend team so the
allowlist can be updated and the `his` stage redeployed.

---

## 1. `GET /crate` — crate master list

Use this to populate the crate-type dropdown (equivalent of the crate selector
you show today in the auction screen).

```
GET /crate
```

```json
{
  "responseCode": "200",
  "responseMessage": "Success",
  "responseBody": [
    { "id": 3, "crate_name": "PLASTIC", "total": 200, "closing_amount": 200 },
    { "id": 4, "crate_name": "WOODEN",  "total": 300, "closing_amount": 300 }
  ]
}
```

⚠️ **Field naming:** the PK comes back as `id` here, but the issue API expects it
as `crate_id`. Map it when building the payload: `{ crate_id: crate.id, ... }`.

---

## 2. `POST /crate/issue` — record crates given to a vyapari

One call per vyapari. Multiple crate types for the same vyapari can go in a
single call.

```
POST /crate/issue
Content-Type: application/json
```

```json
{
  "vyapariId": "V52",
  "date": "2026-07-08",
  "crates": [
    { "crate_id": 3, "count": 2 },
    { "crate_id": 4, "count": 1 }
  ]
}
```

Success response (`200`) echoes the inserted rows:

```json
{
  "responseCode": "200",
  "responseMessage": "Success",
  "responseBody": [
    { "id": 140, "vyapari_id": "V52", "crate_id": 3, "crate_count": 2, "parent_id": null, "date": "2026-07-08" }
  ]
}
```

### Validation rules (400 on violation)

| Field | Rule |
|---|---|
| `vyapariId` | non-empty string (party id of the vyapari, e.g. `"V52"`) |
| `date` | `YYYY-MM-DD` — the auction/issue date, **not** a timestamp |
| `crates` | non-empty array |
| `crates[].crate_id` | positive integer (`id` from `GET /crate`) |
| `crates[].count` | **positive** integer — do not send `0` or negative |

Error example:

```json
{
  "responseCode": "400",
  "responseMessage": "Invalid request body",
  "responseBody": [{ "path": "crates.0.count", "message": "Too small: expected number to be >0" }]
}
```

---

## Mapping from the current auction flow

Today the (new-backend) auction payload captures crates like this:

```jsonc
// POST /auction — for reference, prod does NOT call this yet
[{
  "kisanId": "K123",
  "crate_id": 4,              // crate type the kisan's produce is in
  "auctionDate": "2026-07-08",
  "buyItems": [
    { "vyapariId": "V52",  "crate_count": 2, ... },
    { "vyapariId": "V488", "crate_count": 3, ... }
  ]
}]
```

To reproduce that with the standalone API, after the auction is saved in the
current prod system, fire one `POST /crate/issue` per vyapari that took crates:

```jsonc
POST /crate/issue  →  { "vyapariId": "V52",  "date": "2026-07-08", "crates": [{ "crate_id": 4, "count": 2 }] }
POST /crate/issue  →  { "vyapariId": "V488", "date": "2026-07-08", "crates": [{ "crate_id": 4, "count": 3 }] }
```

Notes:

- **Skip vyaparis with `crate_count` 0** — the API rejects zero counts, and a
  zero row adds nothing to reports.
- If the same vyapari takes crates from several kisans' lots on the same day,
  either send separate calls or merge into one call with multiple `crates`
  entries — the reports sum everything per vyapari per date either way.
- **No dedupe on the server.** A retry after a network timeout can double-insert.
  Disable the submit button while in flight, and don't blind-retry on timeout;
  verify via `GET /crate/summary?p_date=YYYY-MM-DD` before resubmitting.

---

## Verifying data landed

```
GET /crate/summary?p_date=2026-07-08
```

```json
{
  "responseBody": [
    {
      "date": "2026-07-08",
      "vyapari_id": "V52",
      "vyapari_name": "L HARI OM RAMBATY",
      "crates": [{ "crate_id": 3, "crate_name": "PLASTIC", "crate_count": 2 }]
    }
  ]
}
```

Issued crates appear as positive `crate_count`; returns (via the existing
`POST /crate/return`, same body shape as `/crate/issue`) appear negative.
