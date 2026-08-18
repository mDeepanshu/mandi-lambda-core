# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                               # Install dependencies
npx sls offline start --stage dev         # Run locally at http://localhost:3000
npx sls deploy --stage dev                # Deploy to dev
npx sls deploy --stage his                # Deploy to his (staging)
npx sls deploy --stage hmb                # Deploy to hmb (production)
npx sls invoke local -f auction --path src/auction/mock.json  # Invoke a function locally
npm run seed:tts -- --stage dev           # Render the Hindi TTS clip alphabet into Supabase
```

There is no test runner configured.

## Architecture

This is an AWS Lambda backend for an agricultural marketplace platform ("Mandi"). Nine independent Lambda functions (one per domain) are exposed via HTTP API Gateway. Each function handles all routes for its domain internally.

### Request Flow

```
HTTP API Gateway → handler.ts → routes.ts → controller.ts → service (optional) → *.repo.ts → Supabase
```

1. **`handler.ts`** — Lambda entrypoint. Wraps `route()` with a top-level try/catch; all unhandled errors are normalized here via `handleError()`.
2. **`routes.ts`** — Dispatches by `event.httpMethod` + `event.path` to the correct controller function. Returns `routeNotFound()` for unmatched routes.
3. **`controller.ts`** — Validates request input using helpers from `src/common/validation.ts`, calls service/repo, and returns a shaped response via `src/common/response.util.ts`.
4. **`*.repo.ts`** — All Supabase calls live here. Uses `supabase.rpc()` for stored procedures or `.from().select/insert/update()` for direct table access. Destructures `{ data, error }` and throws on error.

### Serverless Config (`serverless.ts`)

- Runtime: Node.js 20.x, region: `ap-south-1`
- Stage: `${opt:stage, "dev"}` — supports `dev`, `his`, `hmb`
- Each domain has one function with path `/{domain}/{proxy+}` routing to its handler
- Supabase credentials injected per-stage from `custom.supabase` — no `.env` file; secrets live in `serverless.ts`
- Bundled with `serverless-esbuild` (individual packaging per function, ES2022 target)
- CORS configured for localhost dev ports and production Vercel URLs

### Common Utilities (`src/common/`)

**`error.ts`** — `AppError` class with `statusCode`, `details`, and `expose` flag.
- `expose: true` → 4xx errors; details returned to client
- `expose: false` → 5xx errors; details logged only
- Helpers: `badRequest()`, `notFound()`, `handleError()`

**`response.util.ts`** — All responses use `CommonApiResponse`:
```json
{ "responseCode": "200", "responseMessage": "...", "responseBody": {} }
```
Builders: `success(body, created?)` → 200/201, `error(message, code, body)` → any status.

**`validation.ts`** — Zod-based helpers:
- `validateBody(event, schema)` — parses and validates JSON body
- `validateQuery(event, schema)` — validates query string params
- `validateHeaders(event, schema)` — case-insensitive header validation
- All throw `badRequest()` with formatted Zod issue details on failure
- Common field helpers: `nonEmptyString`, `optionalString`, `optionalNumber`

### Domain Module Structure

Each of the 9 domains (`auction`, `bill`, `crate`, `device`, `item`, `kisan`, `party`, `tts`, `vyapari`) follows:

```
src/{domain}/
├── handler.ts       # Lambda entrypoint
├── routes.ts        # Method + path → controller dispatch
├── controller.ts    # Input validation + response building
├── validation.ts    # Zod schemas for this domain
└── {domain}.repo.ts # Supabase data access
```

`tts` adds three domain-specific files: `tokens.ts` (the Hindi clip alphabet and
number decomposition), `audio.ts` (WAV parsing / silence trimming) and
`sarvam.ts` (the TTS provider client).

### Adding a New Endpoint

1. Add route match in `routes.ts` (check method + path)
2. Add controller function — validate input, call repo, return `success()`
3. Add Zod schema in `validation.ts`
4. Add repo function in `*.repo.ts` — call `supabase.rpc()` or direct query

### Naming Conventions

- Repo functions: `fetch*` for reads, `create*` / `edit*` / `delete*` for writes
- Zod schemas: `{action}{Target}BodySchema` / `{action}{Target}QuerySchema`
- Schema types (inferred): append `SchemaType` suffix
- DTOs/models: `{Domain}{Purpose}DTO` or `{Domain}{Purpose}ResponseDTO`

## Database Schema (Supabase / PostgreSQL)

### `party`
Central table for both kisans (farmers, `party_type=0`) and vyaparis (traders, `party_type=1`).
- `party_id` varchar PK, `id_no` int (auto, unique), `name`, `contact`, `party_type` (0=kisan, 1=vyapari)
- `owed_amount` numeric, `max_loan_days` int, `last_vasuli_date` date
- `ledger_order` int, `last_notified_amount` numeric, `party_code` varchar
- `kisan_type` varchar (default `'A'`), `commission_rate` numeric

### `items`
- `item_id` varchar PK, `name` varchar

### `device_details`
Weighing/auction devices.
- `id` int PK (auto), `name` varchar, `status` varchar — one of `REQUESTED | REJECTED | APPROVED | DELETED`
- `creation_date`, `updation_time` timestamps

### `auction`
One auction per kisan per session.
- `auction_id` uuid PK, `auction_date` timestamp, `item_id` → items, `kisan_id` → party, `total_bags` int, `device_id` → device_details

### `auction_transaction`
Individual lot sales within an auction.
- `auction_transaction_id` uuid PK, `auction_id` → auction, `auction_date` timestamp
- `bag` int, `quantity` numeric, `rate` numeric, `vyapari_id` → party
- `parent_id` varchar, `is_old` varchar (default `'N'`), `chungi` int (default 0)
- `bag_wise_quantity` varchar, `txn_no` int, `validated` varchar (default `'N'`)

### `kisan_bill`
Settlement bill for a kisan after auction.
- `kisan_bill_id` int PK (auto), `kisan_id` → party, `kisan_name` varchar, `bill_date` date
- Deductions: `mandi_kharcha`, `hammali`, `nagar_palika_tax`, `bhada`, `driver_inaam`, `nagdi`, `commission` (all double precision)
- Totals: `kharcha_total`, `pakki_bikri`, `kaccha_total` double precision

### `kisan_bill_item`
Line items within a kisan bill.
- `kisan_bill_item_id` bigint PK, `kisan_bill_id` → kisan_bill
- `item_name`, `vyapari_name`, `vyapari_id` varchar, `date` date
- `bag` int, `rate` double, `quantity` numeric, `item_total` double

### `kisan_bill_pending_stock`
Unsold stock from a kisan bill.
- `id` bigint (identity, unique), `kisan_bill_id` → kisan_bill, `item_id` → items
- `item_name` varchar, `quantity` smallint, `sold` boolean (default false), `created_at` timestamptz

### `vyapari_bill`
Bill raised against a vyapari.
- `id` bigint PK, `vyapari_id` → party, `vyapari_name` varchar, `bill_date` date
- `current_outstanding` numeric, `created_at`, `updated_at` timestamps

### `vyapari_bill_item`
Line items within a vyapari bill.
- `id` bigint PK, `vyapari_bill_id` → vyapari_bill
- `item_name` varchar, `bag` int, `rate` numeric, `quantity` numeric, `item_total` numeric
- `created_at`, `updated_at` timestamps

### `vasuli`
Payment/collection records from vyaparis.
- `id` varchar PK, `vyapari_id` → party, `amount` numeric, `date` timestamp, `remark` varchar, `was_null` boolean

### `crate`
Crate (container) master.
- `id` smallint PK (identity, unique), `crate_name` varchar, `total` smallint, `closing_amount` smallint

### `crate_transaction`
Movement of crates to/from vyaparis.
- `id` bigint PK (identity, unique), `vyapari_id` → party, `crate_id` → crate
- `crate_count` smallint, `parent_id` text, `date` date
- `txn_type` varchar — `ISSUE | RETURN` (default `'ISSUE'`)
- `created_at` timestamptz (default `now()`) — first-issue time; ON CONFLICT re-issues keep the original value

### `tts_clip`
Manifest for pre-rendered Hindi text-to-speech clips. The auction UI announces
vasuli entries by concatenating a **closed alphabet** of ~115 clips (0–99 plus
सौ/हज़ार/लाख/करोड़ plus fixed phrases), which covers every rupee amount up to
9,99,99,999 — so runtime TTS cost is zero and announcements work offline.
- `id` bigint PK (identity), `token` text — the exact text rendered, and the client's lookup key
- `voice` text (default `'aditya'`), `lang` text (default `'hi-IN'`)
- `storage_path` text — key in the public `tts` Storage bucket
- `duration_ms`, `sample_rate`, `byte_size` int, `created_at` timestamptz
- unique `(token, voice, lang)`

Audio bytes live in Supabase Storage, not this table. Seed with
`npm run seed:tts`; `POST /tts/clips` renders on demand for anything unseeded.
