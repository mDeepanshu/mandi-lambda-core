-- Audit column for auction_transaction: "when was this row actually entered".
--
-- Needed because auction_transaction.auction_date now carries the BUSINESS
-- date (the operator-entered auctionDate, so backdated entries file on the
-- backdate in every report -- see db/auction_txn_date_from_payload*.sql).
-- Before that change auction_date doubled as the entry timestamp; created_at
-- takes over that job.
--
-- timestamptz on purpose: it stores an absolute instant, immune to the
-- UTC-vs-IST confusion that plagued the naive columns. Render in IST client-side.
--
-- Backfill: existing rows get created_at derived from auction_date, which
-- until now WAS the entry time (IST wall-clock after the 2026-07-19 timezone
-- fix, UTC before it -- so pre-fix rows sit 5h30m off; acceptable for audit
-- metadata). ⚠ DO NOT RE-RUN the UPDATE once real created_at values exist:
-- it would overwrite genuine entry times with business dates.
--
-- Stage-agnostic: safe on dev, his and hmb (run ONCE each).

ALTER TABLE auction_transaction
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE auction_transaction
SET created_at = auction_date AT TIME ZONE 'Asia/Kolkata';
