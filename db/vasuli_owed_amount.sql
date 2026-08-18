-- Vasuli fixes (2026-07-11):
-- 1. insert_vasuli now decrements party.owed_amount (a payment reduces dues),
--    mirroring how auction creation increments it.
-- 2. insert_vasuli_bulk: atomic multi-payment insert for
--    POST /party/vasuliTrasaction, which previously processed only the first
--    array element. Returns [{vyapariId, id, amount}] for id capture.
-- 3. edit_vasuli now adjusts owed_amount for amount changes and handles
--    reassignment to a different vyapari.

create or replace function insert_vasuli(
  p_amount numeric,
  p_date timestamp without time zone,
  p_vyapari_id text,
  p_remark text default null,
  p_was_null boolean default false
)
returns text
language plpgsql
as $$
declare
  v_id text;
begin
  v_id := gen_random_uuid()::text;

  insert into vasuli (id, amount, date, vyapari_id, remark, was_null)
  values (v_id, p_amount, p_date, p_vyapari_id, p_remark, p_was_null);

  update party
  set owed_amount = coalesce(owed_amount, 0) - p_amount
  where party_id = p_vyapari_id;

  return v_id;
end;
$$;

create or replace function insert_vasuli_bulk(p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_results jsonb := '[]'::jsonb;
  v_item jsonb;
  v_id text;
begin
  if p_payload is null or jsonb_array_length(p_payload) = 0 then
    raise exception 'payload cannot be empty';
  end if;

  for v_item in select * from jsonb_array_elements(p_payload) loop
    v_id := insert_vasuli(
      (v_item->>'amount')::numeric,
      (v_item->>'date')::timestamp,
      v_item->>'vyapariId',
      v_item->>'remark',
      coalesce((v_item->>'was_null')::boolean, false)
    );
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'vyapariId', v_item->>'vyapariId',
      'amount', (v_item->>'amount')::numeric
    ));
  end loop;

  return v_results;
end;
$$;

create or replace function edit_vasuli(
  p_id text,
  p_amount numeric default null,
  p_date timestamp without time zone default null,
  p_vyapari_id text default null,
  p_remark text default null,
  p_was_null boolean default null
)
returns vasuli
language plpgsql
as $$
declare
  old_row vasuli;
  updated_row vasuli;
begin
  select * into old_row from vasuli where id = p_id;
  if not found then
    raise exception 'Vasuli entry not found for id: %', p_id;
  end if;

  update vasuli
  set
    amount     = coalesce(p_amount, amount),
    date       = coalesce(p_date, date),
    vyapari_id = coalesce(p_vyapari_id, vyapari_id),
    remark     = coalesce(p_remark, remark),
    was_null   = coalesce(p_was_null, was_null)
  where id = p_id
  returning * into updated_row;

  if updated_row.vyapari_id is distinct from old_row.vyapari_id then
    -- reassigned: give the old vyapari its dues back, reduce the new one's
    update party
    set owed_amount = coalesce(owed_amount, 0) + old_row.amount
    where party_id = old_row.vyapari_id;

    update party
    set owed_amount = coalesce(owed_amount, 0) - updated_row.amount
    where party_id = updated_row.vyapari_id;
  else
    -- same vyapari: apply only the amount delta
    update party
    set owed_amount = coalesce(owed_amount, 0) + (old_row.amount - updated_row.amount)
    where party_id = updated_row.vyapari_id;
  end if;

  return updated_row;
end;
$$;
