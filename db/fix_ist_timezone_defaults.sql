-- IST timezone fix, part 2 of 2: column defaults.
--
-- The Supabase DB session runs in UTC, but the mandi operates in IST
-- (UTC+5:30). Any NAIVE column (`timestamp without time zone` / `date`) that
-- is filled from the server clock therefore captures UTC wall-clock as if it
-- were local time. Between 18:30 and 24:00 UTC -- i.e. 00:00 to 05:30 IST --
-- the stored date is a full day behind the mandi's.
--
-- These six defaults are audit metadata (no business logic keys off them), so
-- the effect is cosmetic: timestamps display 5h30m behind. Fixed for
-- consistency so nothing in the schema silently disagrees about "now".
--
-- NOT touched, deliberately: crate_transaction.created_at and
-- kisan_bill_pending_stock.created_at are `timestamptz`. Those store an
-- absolute instant and are already correct -- rendering them in IST is a
-- client concern, not a storage one.
--
-- Part 1 (db/fix_ist_timezone.sql) covers the RPC bodies, including the one
-- that actually corrupts business data: auction_transaction.auction_date.
--
-- Stage-agnostic: safe to run on dev, his and hmb as-is.

ALTER TABLE device_details
  ALTER COLUMN creation_date SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata');
ALTER TABLE device_details
  ALTER COLUMN updation_time SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata');

ALTER TABLE vyapari_bill
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata');
ALTER TABLE vyapari_bill
  ALTER COLUMN updated_at SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata');

ALTER TABLE vyapari_bill_item
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata');
ALTER TABLE vyapari_bill_item
  ALTER COLUMN updated_at SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata');
