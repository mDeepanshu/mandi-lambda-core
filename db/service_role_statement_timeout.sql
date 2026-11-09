-- The lambdas call PostgREST with the secret key: PostgREST logs in as
-- `authenticator` (statement_timeout=8s) and switches to `service_role`, which
-- had no timeout of its own, so the 8s applied. A cold-cache
-- POST /vyapari/ledger-list batch (100 vyaparis x 180 days, the ledger cache
-- sync) needs ~9s on his and was cancelled with 57014. Give service_role its
-- own limit, below the 29s lambda / 30s HTTP API caps, so slow calls still
-- finish with a clean error rather than a gateway timeout.
--
-- Rollback: alter role service_role reset statement_timeout;
--           notify pgrst, 'reload config';

alter role service_role set statement_timeout = '25s';
notify pgrst, 'reload config';
