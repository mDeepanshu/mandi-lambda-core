-- Per-client switches for db/legacy_parity_api.sql — hmb only (dev/his use
-- db/legacy_client_his.sql). hmb charges chungi per bag, not per kg. Apply
-- BEFORE the shared file, in the same session:
--   psql -v ON_ERROR_STOP=1 -1 -f db/legacy_client_hmb.sql -f db/legacy_parity_api.sql
--
-- COALESCEs as in hmb's other lambda functions: the old hmb server's
-- (chungi*bag)+(rate*quantity) went NULL — and dropped out of every SUM — for a
-- row without a bag count.

create or replace function legacy_client() returns text
language sql immutable as $$ select 'hmb'::text $$;

create or replace function legacy_txn_amount(p_rate numeric, p_chungi integer, p_quantity numeric, p_bag integer)
returns numeric
language sql immutable as $$ select p_rate * p_quantity + coalesce(p_chungi, 0) * coalesce(p_bag, 0) $$;
