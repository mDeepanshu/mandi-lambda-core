-- Absolute-set edit of a vyapari's crate RETURN (vasuli) rows for a single date.
-- Counts arrive positive and are stored negative on the manual row (parent_id is
-- null) — returns are never auction-linked. Only the crate_ids present in the
-- payload are touched; count 0 removes the row. ISSUE rows for the same day are
-- untouched — those are edited via edit_crate_summary.
--
-- Reassignment: an optional newVyapariId moves the payload's crate_ids to another
-- vyapari (the entry was filed against the wrong person). Only the crate_ids sent
-- move; anything else the source vyapari has that date stays with them.
--
-- If the target already has RETURN rows that date for any of those crate_ids, the
-- move would silently combine two people's counts, so the function refuses on the
-- first call and returns status CONFLICT with a preview of the merged result. The
-- client shows it, and re-sends with confirmMerge true to apply. Counts are summed
-- on confirm. Nothing is written on the CONFLICT return.
create or replace function edit_crate_vasuli(p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_vyapari_id text := p_payload->>'vyapariId';
  v_new_vyapari_id text := p_payload->>'newVyapariId';
  v_date date := (p_payload->>'date')::date;
  v_confirm boolean := coalesce((p_payload->>'confirmMerge')::boolean, false);
  v_target text;
  v_conflicts jsonb;
  v_result jsonb;
begin
  -- reassigning to the same vyapari is a plain edit, not a move
  if v_new_vyapari_id = v_vyapari_id then
    v_new_vyapari_id := null;
  end if;
  v_target := coalesce(v_new_vyapari_id, v_vyapari_id);

  if v_new_vyapari_id is not null then
    if not exists (select 1 from party where party_id = v_new_vyapari_id) then
      raise exception 'Vyapari % not found', v_new_vyapari_id using errcode = '23503';
    end if;

    select jsonb_agg(
             jsonb_build_object(
               'crate_id', x.crate_id,
               'crate_name', x.crate_name,
               'existing_count', x.existing_count,
               'incoming_count', x.incoming_count,
               'merged_count', x.existing_count + x.incoming_count
             )
             order by x.crate_id
           )
    into v_conflicts
    from (
      select
        ct.crate_id,
        c.crate_name,
        abs(ct.crate_count) as existing_count,
        (e->>'count')::int as incoming_count
      from crate_transaction ct
      join crate c on c.id = ct.crate_id
      join jsonb_array_elements(p_payload->'crates') e
        on (e->>'crate_id')::smallint = ct.crate_id
      where ct.vyapari_id = v_new_vyapari_id
        and ct.date = v_date
        and ct.txn_type = 'RETURN'
        and ct.parent_id is null
        and (e->>'count')::int > 0
    ) x;

    if v_conflicts is not null and not v_confirm then
      return jsonb_build_object(
        'status', 'CONFLICT',
        'from_vyapari_id', v_vyapari_id,
        'to_vyapari_id', v_new_vyapari_id,
        'to_vyapari_name', (select name from party where party_id = v_new_vyapari_id),
        'date', v_date,
        'conflicts', v_conflicts
      );
    end if;
  end if;

  if v_new_vyapari_id is null then
    delete from crate_transaction ct
    using jsonb_array_elements(p_payload->'crates') as c
    where ct.vyapari_id = v_vyapari_id
      and ct.date = v_date
      and ct.txn_type = 'RETURN'
      and ct.parent_id is null
      and ct.crate_id = (c->>'crate_id')::smallint
      and (c->>'count')::int = 0;

    -- crate_ids are deduped by the API layer, so ON CONFLICT never has to update
    -- the same row twice in one statement
    insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type)
    select
      v_vyapari_id,
      (c->>'crate_id')::smallint,
      -(c->>'count')::smallint,
      v_date,
      null,
      'RETURN'
    from jsonb_array_elements(p_payload->'crates') as c
    where (c->>'count')::int > 0
    on conflict (vyapari_id, crate_id, date, txn_type, parent_id)
    do update set crate_count = excluded.crate_count;
  else
    -- Move: drop the source rows for the payload's crate_ids and re-insert them
    -- under the target, carrying the original created_at across so a reassignment
    -- does not restamp the entry with the time of the correction. A count of 0
    -- clears the source row and contributes nothing to the target — the target's
    -- own row for that crate, if any, is left alone.
    with moved as (
      delete from crate_transaction ct
      using jsonb_array_elements(p_payload->'crates') as c
      where ct.vyapari_id = v_vyapari_id
        and ct.date = v_date
        and ct.txn_type = 'RETURN'
        and ct.parent_id is null
        and ct.crate_id = (c->>'crate_id')::smallint
      returning ct.crate_id, ct.created_at
    )
    insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type, created_at)
    select
      v_new_vyapari_id,
      (c->>'crate_id')::smallint,
      -(c->>'count')::smallint,
      v_date,
      null,
      'RETURN',
      coalesce(m.created_at, now())
    from jsonb_array_elements(p_payload->'crates') as c
    left join moved m on m.crate_id = (c->>'crate_id')::smallint
    where (c->>'count')::int > 0
    on conflict (vyapari_id, crate_id, date, txn_type, parent_id)
    do update set
      crate_count = crate_transaction.crate_count + excluded.crate_count,
      created_at = least(crate_transaction.created_at, excluded.created_at);
  end if;

  select jsonb_build_object(
    'status', 'OK',
    'vyapari_id', p.party_id,
    'vyapari_name', p.name,
    'date', v_date,
    'moved_from', case when v_new_vyapari_id is not null then v_vyapari_id end,
    'merged', v_conflicts is not null,
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
        select ct.crate_id, c.crate_name, abs(sum(ct.crate_count)) as crate_count
        from crate_transaction ct
        join crate c on c.id = ct.crate_id
        where ct.vyapari_id = p.party_id
          and ct.date = v_date
          and ct.txn_type = 'RETURN'
        group by ct.crate_id, c.crate_name
        having sum(ct.crate_count) <> 0
      ) s
    ), '[]'::jsonb)
  )
  into v_result
  from party p
  where p.party_id = v_target;

  if v_result is null then
    raise exception 'Vyapari % not found', v_target using errcode = '23503';
  end if;

  return v_result;
end;
$$;
