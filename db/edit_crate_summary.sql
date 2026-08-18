-- Absolute-set edit of a vyapari's MANUAL crate ISSUE row (parent_id is null) for
-- a single date. Only the crate_ids present in the payload are touched; count 0
-- removes the row. Auction-linked ISSUE rows are never written here — they are
-- edited via edit_crate_auction_entry — but they ARE included in the summed
-- 'crates' returned below, so the response matches get_crate_summary_by_date.
-- The day's RETURN rows are untouched (see edit_crate_vasuli).
create or replace function edit_crate_summary(p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_vyapari_id text := p_payload->>'vyapariId';
  v_date date := (p_payload->>'date')::date;
  v_result jsonb;
begin
  delete from crate_transaction ct
  using jsonb_array_elements(p_payload->'crates') as c
  where ct.vyapari_id = v_vyapari_id
    and ct.date = v_date
    and ct.txn_type = 'ISSUE'
    and ct.parent_id is null
    and ct.crate_id = (c->>'crate_id')::smallint
    and (c->>'count')::int = 0;

  -- crate_ids are deduped by the API layer, so ON CONFLICT never has to update
  -- the same row twice in one statement
  insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type)
  select
    v_vyapari_id,
    (c->>'crate_id')::smallint,
    (c->>'count')::smallint,
    v_date,
    null,
    'ISSUE'
  from jsonb_array_elements(p_payload->'crates') as c
  where (c->>'count')::int > 0
  on conflict (vyapari_id, crate_id, date, txn_type, parent_id)
  do update set crate_count = excluded.crate_count;

  select jsonb_build_object(
    'vyapari_id', p.party_id,
    'vyapari_name', p.name,
    'date', v_date,
    'crates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'crate_id', s.crate_id,
          'crate_name', s.crate_name,
          'crate_count', s.crate_count
        )
        order by s.crate_id
      )
      from (
        select ct.crate_id, c.crate_name, sum(ct.crate_count) as crate_count
        from crate_transaction ct
        join crate c on c.id = ct.crate_id
        where ct.vyapari_id = p.party_id
          and ct.date = v_date
          and ct.txn_type = 'ISSUE'
        group by ct.crate_id, c.crate_name
        having sum(ct.crate_count) <> 0
      ) s
    ), '[]'::jsonb)
  )
  into v_result
  from party p
  where p.party_id = v_vyapari_id;

  if v_result is null then
    raise exception 'Vyapari % not found', v_vyapari_id using errcode = '23503';
  end if;

  return v_result;
end;
$$;
