-- Per-transaction audit trail for crate movements.
--
-- crate_transaction stays an AGGREGATED balance: one row per
-- (vyapari_id, crate_id, date, txn_type, parent_id), with same-day re-issues
-- and multi-lot auction crates summed into that row via ON CONFLICT DO UPDATE.
-- That model is what every reader (summary, ledger, stock report, vasuli,
-- pending) and every "absolute set" editor depends on, so it is left untouched.
--
-- This adds a parallel APPEND-ONLY log that records every individual change to
-- crate_transaction as its own immutable row. A single trigger captures all
-- write paths at once (create_crate_issue, create_crate_return,
-- edit_crate_summary, edit_crate_vasuli, edit_crate_auction_entry and every
-- auction-bulk function), so none of those functions have to be edited and any
-- future writer is covered automatically.
--
-- The signed `delta` is the amount moved by each operation:
--   INSERT  -> +new_count            (first issue/return/auction line)
--   UPDATE  -> new_count - old_count (the amount a same-day re-issue added, or
--                                     an "absolute set" edit's difference)
--   DELETE  -> -old_count            (an edit that removed the row)
-- SUM(delta) over the log for any combo therefore reproduces the current
-- crate_transaction.crate_count exactly.
--
-- Safe to apply to dev / his / hmb: crate_transaction has the same shape on all
-- three (the hmb formula difference is in the auction/owed math, not this table).
begin;

create table if not exists crate_transaction_log (
  id                   bigint generated always as identity primary key,
  -- the aggregated row this change belongs to; kept for reference only, not a
  -- FK because the aggregated row can later be deleted by an edit
  crate_transaction_id bigint,
  vyapari_id           varchar,
  crate_id             smallint,
  date                 date,
  txn_type             varchar,
  -- NULL = manual issue/return, non-NULL = auction-linked (auction_id)
  parent_id            text,
  -- 'INSERT' | 'UPDATE' | 'DELETE'
  op                   varchar     not null,
  -- signed change in crate_count contributed by this operation
  delta                smallint    not null,
  old_count            smallint,
  new_count            smallint,
  logged_at            timestamptz not null default now()
);

create index if not exists idx_crate_txn_log_vyapari_date
  on crate_transaction_log (vyapari_id, date);

create index if not exists idx_crate_txn_log_txn
  on crate_transaction_log (crate_transaction_id);

create or replace function log_crate_transaction()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    insert into crate_transaction_log
      (crate_transaction_id, vyapari_id, crate_id, date, txn_type, parent_id,
       op, delta, old_count, new_count)
    values
      (new.id, new.vyapari_id, new.crate_id, new.date, new.txn_type, new.parent_id,
       'INSERT', new.crate_count, null, new.crate_count);
    return new;

  elsif (tg_op = 'UPDATE') then
    -- skip no-op updates that leave the count unchanged
    if new.crate_count is distinct from old.crate_count then
      insert into crate_transaction_log
        (crate_transaction_id, vyapari_id, crate_id, date, txn_type, parent_id,
         op, delta, old_count, new_count)
      values
        (new.id, new.vyapari_id, new.crate_id, new.date, new.txn_type, new.parent_id,
         'UPDATE', new.crate_count - old.crate_count, old.crate_count, new.crate_count);
    end if;
    return new;

  elsif (tg_op = 'DELETE') then
    insert into crate_transaction_log
      (crate_transaction_id, vyapari_id, crate_id, date, txn_type, parent_id,
       op, delta, old_count, new_count)
    values
      (old.id, old.vyapari_id, old.crate_id, old.date, old.txn_type, old.parent_id,
       'DELETE', -old.crate_count, old.crate_count, 0);
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_log_crate_transaction on crate_transaction;

create trigger trg_log_crate_transaction
after insert or update or delete on crate_transaction
for each row execute function log_crate_transaction();

commit;
