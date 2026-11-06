-- Per-client switches for db/legacy_parity_api.sql — dev and his. hmb has its
-- own copy, db/legacy_client_hmb.sql. Apply the client file BEFORE the shared
-- one, in the same session:
--   psql -v ON_ERROR_STOP=1 -1 -f db/legacy_client_his.sql -f db/legacy_parity_api.sql   # dev, his
--
-- Everything that differs between the two old servers (app-runner-prod for
-- his, app-runner-prod-2 for hmb) outside the money formula is a branch on
-- legacy_client() inside the shared file.

create or replace function legacy_client() returns text
language sql immutable as $$ select 'his'::text $$;

-- one auction transaction's money, as the his server computes it
create or replace function legacy_txn_amount(p_rate numeric, p_chungi integer, p_quantity numeric, p_bag integer)
returns numeric
language sql immutable as $$ select (p_rate + p_chungi) * p_quantity $$;
