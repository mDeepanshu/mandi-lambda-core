-- Range index on auction_transaction.auction_date. Serves the txn_no trigger
-- (db/auction_txn_no.sql) and generate_auction_ledger's per-day join; the
-- existing (vyapari_id, auction_date) indexes cannot answer "all of one day".
-- Legacy MySQL has the equivalent `auction-date_idx`.
--
-- CONCURRENTLY: no write lock on a live table, but it cannot run inside a
-- transaction — apply WITHOUT -1:
--   psql -v ON_ERROR_STOP=1 -f db/auction_txn_no_index.sql
create index concurrently if not exists idx_at_auction_date on auction_transaction (auction_date);
