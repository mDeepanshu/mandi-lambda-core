create or replace function create_crate_issue(p_payload jsonb)
returns setof crate_transaction
language sql
as $$
  insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type)
  select
    p_payload->>'vyapariId',
    x.crate_id,
    x.cnt,
    (p_payload->>'date')::date,
    null,
    'ISSUE'
  from (
    -- pre-aggregate duplicates within the payload itself: ON CONFLICT
    -- cannot update the same row twice in one statement
    select
      (c->>'crate_id')::smallint as crate_id,
      sum((c->>'count')::int)::smallint as cnt
    from jsonb_array_elements(p_payload->'crates') as c
    group by 1
  ) as x
  -- parent_id is null (manual issue); the unique key is NULLS NOT DISTINCT, so
  -- this still aggregates with the day's other manual issues and never touches
  -- the auction-linked rows
  on conflict (vyapari_id, crate_id, date, txn_type, parent_id)
  do update set crate_count = crate_transaction.crate_count + excluded.crate_count
  returning *;
$$;
