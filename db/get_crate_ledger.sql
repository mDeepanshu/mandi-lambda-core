-- Crate ledger for one vyapari over a date range: one row per individual crate
-- movement, read from crate_transaction_log, oldest first within each date.
--
-- crate_transaction is aggregated — create_crate_issue / create_crate_return
-- ON CONFLICT-sum same-day movements of a crate into one row — so reading it
-- here showed e.g. four returns of 5, 3, 2 and 3 as a single -13. The log keeps
-- each POST /crate/issue, POST /crate/return, auction line-group and edit as its
-- own entry.
--
-- The original fields (date, crate_id, crate_name, crate_count) are unchanged;
-- crate_count is the signed amount of that one movement (returns negative, as
-- before). Added: txn_type, source (MANUAL | AUCTION), parent_id, op
-- (INSERT = new movement, UPDATE = same-day add-on or edit, DELETE = edit that
-- removed the row), logged_at and log_id.
--
-- SUM(crate_count) per (date, crate_id, txn_type, parent_id) always equals
-- crate_transaction. Rows written before add_crate_transaction_log.sql was
-- applied have no log history, so whatever the log can't account for comes back
-- as one op = 'UNLOGGED' row (log_id null).
create or replace function get_crate_ledger(p_vyapari_id text, p_from_date date, p_to_date date)
returns jsonb
language sql
stable
as $$
  with logged as (
    select l.id, l.date, l.crate_id, l.txn_type, l.parent_id, l.op, l.delta, l.logged_at
    from crate_transaction_log l
    where l.vyapari_id = p_vyapari_id
      and l.date between p_from_date and p_to_date
      and l.delta <> 0
  ),
  current_rows as (
    select ct.date, ct.crate_id, ct.txn_type, ct.parent_id,
           sum(ct.crate_count) as crate_count,
           min(ct.created_at) as created_at
    from crate_transaction ct
    where ct.vyapari_id = p_vyapari_id
      and ct.date between p_from_date and p_to_date
    group by ct.date, ct.crate_id, ct.txn_type, ct.parent_id
  ),
  logged_sum as (
    select date, crate_id, txn_type, parent_id, sum(delta) as delta
    from logged
    group by date, crate_id, txn_type, parent_id
  ),
  entry_rows as (
    select id as log_id, date, crate_id, txn_type, parent_id, op, delta as crate_count, logged_at
    from logged
    union all
    -- the part of crate_count with no log history (pre-log rows)
    select
      null,
      coalesce(c.date, s.date),
      coalesce(c.crate_id, s.crate_id),
      coalesce(c.txn_type, s.txn_type),
      coalesce(c.parent_id, s.parent_id),
      'UNLOGGED',
      coalesce(c.crate_count, 0) - coalesce(s.delta, 0),
      c.created_at
    from current_rows c
    full join logged_sum s
      on  s.date = c.date
      and s.crate_id = c.crate_id
      and s.txn_type is not distinct from c.txn_type
      and s.parent_id is not distinct from c.parent_id
    where coalesce(c.crate_count, 0) - coalesce(s.delta, 0) <> 0
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', e.date,
        'crate_id', e.crate_id,
        'crate_name', cr.crate_name,
        'crate_count', e.crate_count,
        'txn_type', e.txn_type,
        'source', case when e.parent_id is null then 'MANUAL' else 'AUCTION' end,
        'parent_id', e.parent_id,
        'op', e.op,
        'logged_at', e.logged_at,
        'log_id', e.log_id
      )
      order by e.date, (e.log_id is not null), e.logged_at, e.log_id
    ),
    '[]'::jsonb
  )
  from entry_rows e
  join crate cr on cr.id = e.crate_id;
$$;
