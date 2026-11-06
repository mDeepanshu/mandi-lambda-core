-- auction_transaction.txn_no: per-device, per-day running number, assigned on
-- insert exactly like the old server's BEFORE INSERT trigger
-- txn_no_generator_prod (MySQL, mandi-prod and mandi-2):
--
--   txn_no = 1 + MAX(txn_no) over that day's rows whose auction has the same
--   device_id; auction_date defaults to now() when not given.
--
-- No RPC here ever set txn_no, so every lambda-created row since the mirror
-- started has txn_no NULL (his 1159 / hmb 1320 rows in the 30 days to
-- 2026-11-03), while every legacy row has one. Edits insert a new row, so an
-- edited transaction gets a fresh number, also as before.
--
-- Differences from the MySQL trigger, all deliberate:
--   * an explicit txn_no is kept: scripts/sync-legacy.ts copies legacy rows with
--     their own numbers (it also disables this trigger for the reload)
--   * auction_date defaults to IST now(), like every other naive column here
--   * an advisory lock per (device, day) closes the read-max-then-insert race
--     two concurrent posts from one device would otherwise have
--   * a NULL device matches NULL devices instead of never matching
--
-- Stage-agnostic (no money formula). Run db/auction_txn_no_index.sql first —
-- without it every insert scans the whole table for the day's max.
--   psql -v ON_ERROR_STOP=1 -1 -f db/auction_txn_no.sql

create or replace function assign_auction_txn_no()
returns trigger
language plpgsql
as $function$
declare
  v_device integer;
  v_day date;
begin
  if new.txn_no is not null then
    return new;
  end if;

  if new.auction_date is null then
    new.auction_date := (now() at time zone 'Asia/Kolkata');
  end if;

  select a.device_id into v_device from auction a where a.auction_id = new.auction_id;
  v_day := new.auction_date::date;

  perform pg_advisory_xact_lock(
    hashtextextended('auction_txn_no:' || coalesce(v_device::text, '') || ':' || v_day::text, 0)
  );

  select coalesce(max(at.txn_no), 0) + 1
  into new.txn_no
  from auction_transaction at
  join auction a on a.auction_id = at.auction_id
  where at.auction_date >= v_day
    and at.auction_date < v_day + 1
    and a.device_id is not distinct from v_device;

  return new;
end;
$function$;

drop trigger if exists trg_auction_txn_no on auction_transaction;
create trigger trg_auction_txn_no
  before insert on auction_transaction
  for each row execute function assign_auction_txn_no();
