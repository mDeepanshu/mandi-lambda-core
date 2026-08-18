-- Separates crate issues from crate returns (vasuli).
--
-- Before this migration a single row per (vyapari_id, crate_id, date) held the
-- NET count: issues added, returns subtracted. A same-day issue and return for
-- the same crate collapsed into one row, so a return could not be listed or
-- edited on its own. txn_type splits them into their own rows.
--
-- Sign convention is unchanged: ISSUE rows are positive, RETURN rows negative.
-- Every reader that does SUM(crate_count) (vasuli sheet, ledger, stock report)
-- therefore keeps producing the same balances without modification.
begin;

alter table crate_transaction
  add column if not exists txn_type varchar;

update crate_transaction
set txn_type = case when crate_count < 0 then 'RETURN' else 'ISSUE' end
where txn_type is null;

alter table crate_transaction
  alter column txn_type set default 'ISSUE',
  alter column txn_type set not null;

alter table crate_transaction
  drop constraint if exists crate_transaction_txn_type_check;

alter table crate_transaction
  add constraint crate_transaction_txn_type_check
  check (txn_type in ('ISSUE', 'RETURN'));

alter table crate_transaction
  drop constraint if exists unique_vyapari_date_crate;

alter table crate_transaction
  add constraint unique_vyapari_date_crate_type
  unique (vyapari_id, crate_id, date, txn_type);

commit;
