-- Raw per-transaction audit trail for a date, read straight from
-- crate_transaction_log. Unlike get_crate_summary_by_date (which nests crates
-- under each vyapari and returns net totals), this returns one flat object per
-- log entry: every individual ISSUE/RETURN movement and every same-day
-- re-issue/edit, in the order they happened.
--
-- All txn_types are included; each row carries txn_type so the client can filter.
-- `delta` is the signed change that operation made; SUM(delta) per
-- (vyapari, crate, date, txn_type) still reconciles to crate_transaction.
--
-- Only rows logged after add_crate_transaction_log.sql was applied appear here.
create or replace function get_crate_summary_by_date_from_log(p_date date)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'vyapari_id', l.vyapari_id,
        'vyapari_name', p.name,
        'crate_id', l.crate_id,
        'crate_name', c.crate_name,
        'txn_type', l.txn_type,
        'op', l.op,
        'delta', l.delta,
        'old_count', l.old_count,
        'new_count', l.new_count,
        'parent_id', l.parent_id,
        'date', l.date,
        'logged_at', l.logged_at
      )
      order by l.logged_at, l.id
    ),
    '[]'::jsonb
  )
  from crate_transaction_log l
  join party p on p.party_id = l.vyapari_id
  join crate c on c.id = l.crate_id
  where l.date = p_date;
$$;
