-- Crate vasuli (returns) collected on a date: one entry per vyapari, with the
-- crates they returned summed per crate. RETURN rows are stored negative; counts
-- are exposed as positive here, which is what the client sends back to
-- edit_crate_vasuli.
create or replace function get_crate_vasuli_list(p_date date)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'vyapari_id', t.vyapari_id,
        'vyapari_name', t.vyapari_name,
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
      -- earliest return of the day across all crate types for this vyapari
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
        abs(sum(ct.crate_count)) as crate_count,
        min(ct.created_at) as created_at
      from crate_transaction ct
      join party p on p.party_id = ct.vyapari_id
      join crate c on c.id = ct.crate_id
      where ct.date = p_date
        and ct.txn_type = 'RETURN'
      group by ct.vyapari_id, p.name, ct.crate_id, c.crate_name
      having sum(ct.crate_count) <> 0
    ) s
    group by s.vyapari_id, s.vyapari_name
  ) t;
$$;
