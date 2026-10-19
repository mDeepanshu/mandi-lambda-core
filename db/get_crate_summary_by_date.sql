-- Crates ISSUED to each vyapari on a date, summed per crate across every source:
-- the manual issue row (parent_id null) plus one row per auction the vyapari
-- bought in. Returns (vasuli) are excluded — they have their own listing via
-- get_crate_vasuli_list.
--
-- Each crate also carries `entries`: the individual movements behind its
-- crate_count, read from crate_transaction_log (one per POST /crate/issue call,
-- auction line-group, or edit), oldest first. crate_transaction itself stays
-- aggregated, so this is the only place the un-summed history survives.
--
-- SUM(entries.count) always equals crate_count. Rows written before
-- add_crate_transaction_log.sql was applied have no log history, so whatever
-- the log can't account for is returned as one leading op = 'UNLOGGED' entry.
create or replace function get_crate_summary_by_date(p_date date)
returns jsonb
language sql
stable
as $$
  with issued as (
    select
      ct.vyapari_id,
      ct.crate_id,
      sum(ct.crate_count) as crate_count,
      min(ct.created_at) as created_at
    from crate_transaction ct
    where ct.date = p_date
      and ct.txn_type = 'ISSUE'
    group by ct.vyapari_id, ct.crate_id
    having sum(ct.crate_count) <> 0
  ),
  logged as (
    select l.vyapari_id, l.crate_id, l.id, l.delta, l.op, l.parent_id, l.logged_at
    from crate_transaction_log l
    where l.date = p_date
      and l.txn_type = 'ISSUE'
      and l.delta <> 0
  ),
  entry_rows as (
    select vyapari_id, crate_id, id as log_id, delta as count, op, parent_id, logged_at
    from logged
    union all
    -- the part of crate_count with no log history (pre-log rows)
    select
      i.vyapari_id,
      i.crate_id,
      null,
      i.crate_count - coalesce(sum(l.delta), 0),
      'UNLOGGED',
      null,
      i.created_at
    from issued i
    left join logged l using (vyapari_id, crate_id)
    group by i.vyapari_id, i.crate_id, i.crate_count, i.created_at
    having i.crate_count - coalesce(sum(l.delta), 0) <> 0
  ),
  entries as (
    select
      vyapari_id,
      crate_id,
      jsonb_agg(
        jsonb_build_object(
          'log_id', log_id,
          'count', count,
          'op', op,
          'source', case when parent_id is null then 'MANUAL' else 'AUCTION' end,
          'parent_id', parent_id,
          'logged_at', logged_at
        )
        order by (log_id is not null), logged_at, log_id
      ) as entries
    from entry_rows
    group by vyapari_id, crate_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'vyapari_id', t.vyapari_id,
        'vyapari_name', t.vyapari_name,
        'date', p_date,
        'created_at', t.created_at,
        'crates', t.crates
      )
      order by t.vyapari_name
    ),
    '[]'::jsonb
  )
  from (
    select
      i.vyapari_id,
      p.name as vyapari_name,
      -- earliest issue of the day, across all crates/sources: "when this
      -- vyapari was first given crates" — clients sort on this for the report
      min(i.created_at) as created_at,
      jsonb_agg(
        jsonb_build_object(
          'crate_id', i.crate_id,
          'crate_name', c.crate_name,
          'crate_count', i.crate_count,
          'created_at', i.created_at,
          'entries', coalesce(e.entries, '[]'::jsonb)
        )
        order by i.crate_id
      ) as crates
    from issued i
    join party p on p.party_id = i.vyapari_id
    join crate c on c.id = i.crate_id
    left join entries e using (vyapari_id, crate_id)
    group by i.vyapari_id, p.name
  ) t;
$$;
