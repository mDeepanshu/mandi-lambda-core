-- A return (vasuli) is stored as a negative crate_count on its own RETURN row,
-- so it never cancels out the day's ISSUE row for the same crate.
-- Returns boolean (not the inserted rows) to keep the existing POST /crate/return
-- response contract unchanged.
create or replace function create_crate_return(p_payload jsonb)
returns boolean
language sql
as $$
  with ins as (
    insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type)
    select
      p_payload->>'vyapariId',
      x.crate_id,
      -x.cnt,
      (p_payload->>'date')::date,
      null,
      'RETURN'
    from (
      -- pre-aggregate duplicates within the payload itself: ON CONFLICT
      -- cannot update the same row twice in one statement
      select
        (c->>'crate_id')::smallint as crate_id,
        sum((c->>'count')::int)::smallint as cnt
      from jsonb_array_elements(p_payload->'crates') as c
      group by 1
    ) as x
    on conflict (vyapari_id, crate_id, date, txn_type, parent_id)
    do update set crate_count = crate_transaction.crate_count + excluded.crate_count
    returning 1
  )
  select true from ins limit 1;
$$;
