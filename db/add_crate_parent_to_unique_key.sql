-- Makes an auction-linked crate row unique per (vyapari, crate, date, auction),
-- so a vyapari who receives the same crate type from two different kisans on one
-- day gets one row per kisan pairing instead of the two collapsing into one.
--
-- NULLS NOT DISTINCT is what keeps manual (non-auction) rows behaving exactly as
-- before: their parent_id is NULL, and under the default NULLS DISTINCT rule two
-- NULL parent_ids would count as different, which would break the same-day
-- aggregation that create_crate_issue relies on. Requires PG 15+ (we are on 17).
--
-- Run add_crate_txn_type.sql first.
begin;

alter table crate_transaction
  drop constraint if exists unique_vyapari_date_crate_type;

alter table crate_transaction
  drop constraint if exists unique_vyapari_date_crate_type_parent;

alter table crate_transaction
  add constraint unique_vyapari_date_crate_type_parent
  unique nulls not distinct (vyapari_id, crate_id, date, txn_type, parent_id);

commit;
