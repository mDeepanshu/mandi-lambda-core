-- Crates ISSUED to each vyapari on a date, summed per crate across every source:
-- the manual issue row (parent_id null) plus one row per auction the vyapari
-- bought in. Returns (vasuli) are excluded — they have their own listing via
-- get_crate_vasuli_list.
create or replace function get_crate_summary_by_date(p_date date)
returns jsonb
language sql
stable
as $$
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
      s.vyapari_id,
      s.vyapari_name,
      -- earliest issue of the day, across all crates/sources: "when this
      -- vyapari was first given crates" — clients sort on this for the report
      min(s.created_at) as created_at,
      jsonb_agg(
        jsonb_build_object(
          'crate_id', s.crate_id,
          'crate_name', s.crate_name,
          'crate_count', s.crate_count,
          'created_at', s.created_at
        )
        order by s.crate_id
      ) as crates
    from (
      select
        ct.vyapari_id,
        p.name as vyapari_name,
        ct.crate_id,
        c.crate_name,
        sum(ct.crate_count) as crate_count,
        min(ct.created_at) as created_at
      from crate_transaction ct
      join party p on p.party_id = ct.vyapari_id
      join crate c on c.id = ct.crate_id
      where ct.date = p_date
        and ct.txn_type = 'ISSUE'
      group by ct.vyapari_id, p.name, ct.crate_id, c.crate_name
      having sum(ct.crate_count) <> 0
    ) s
    group by s.vyapari_id, s.vyapari_name
  ) t;
$$;
