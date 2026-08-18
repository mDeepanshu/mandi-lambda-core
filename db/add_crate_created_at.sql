-- Adds a creation timestamp to crate_transaction so reports can list issues in
-- the order they were entered. Same-day re-issues merge into an existing row
-- via ON CONFLICT and keep that row's original created_at, so the value means
-- "first issued at". Do not re-run: the backfill would overwrite real times.
alter table crate_transaction
  add column created_at timestamptz not null default now();

-- Rows that predate the column all received the migration time from the
-- default; midnight IST of their transaction date is the honest approximation.
update crate_transaction
  set created_at = date::timestamp at time zone 'Asia/Kolkata'
  where date is not null;
