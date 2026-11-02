-- crate_transaction becomes APPEND-ONLY: one row per movement (each manual
-- issue/return line, each auction buyItem), instead of one aggregated row per
-- (vyapari_id, crate_id, date, txn_type, parent_id).
--
-- Why: the aggregated model forced every writer to upsert (ON CONFLICT DO
-- UPDATE), which threw away the individual entries. crate_transaction_log + its
-- trigger were added to rebuild them, but the log could not tell a re-issue
-- (+1) from an absolute-set edit (4 -> 1), so every edit showed up as one more
-- "entry". With one row per movement the entries ARE the rows: totals are
-- SUM(crate_count), and an entry is edited/deleted by its id.
--
-- Every reader already SUMs crate_count, so stock report, vasuli sheet/list and
-- the pending reports are unchanged. create_auction_bulk_with_crate differs per
-- client — apply crate_append_only_auction.sql (dev/his) or
-- crate_append_only_auction_hmb.sql (hmb) in the same session, after this file.
--
-- crate_transaction_log is kept as a frozen archive (no more writes).
--
-- Apply BOTH files in one transaction (they have no begin/commit of their own):
--   psql -v ON_ERROR_STOP=1 -1 -f db/crate_append_only.sql -f db/crate_append_only_auction.sql      # dev, his
--   psql -v ON_ERROR_STOP=1 -1 -f db/crate_append_only.sql -f db/crate_append_only_auction_hmb.sql  # hmb

-- 1. stop logging; nothing reads the log after this migration
drop trigger if exists trg_log_crate_transaction on crate_transaction;
drop function if exists log_crate_transaction();
drop function if exists get_crate_summary_by_date_from_log(date);

-- 2. drop the one-row-per-key rule
alter table crate_transaction drop constraint if exists unique_vyapari_date_crate_type_parent;

-- 3. split historical aggregated rows back into their entries, where the log
-- can do that exactly: every logged change moved the count in the same
-- direction (only re-issues / re-returns, no reducing edit) and the deltas sum
-- to the stored count. Anything else stays one row holding its current total.
-- A pre-fix edit that INCREASED a count (2 -> 3) is indistinguishable from a
-- re-issue and is split like one; the total is exact either way.
with splittable as (
  select ct.id
  from crate_transaction ct
  join crate_transaction_log l on l.crate_transaction_id = ct.id and l.delta <> 0
  group by ct.id, ct.crate_count
  having count(*) > 1
     and sum(l.delta) = ct.crate_count
     and bool_and(sign(l.delta) = sign(ct.crate_count))
),
removed as (
  delete from crate_transaction ct
  using splittable s
  where ct.id = s.id
  returning ct.*
)
insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type, created_at)
select
  r.vyapari_id,
  r.crate_id,
  l.delta,
  r.date,
  r.parent_id,
  r.txn_type,
  -- the first piece keeps the row's own created_at (it may have been carried
  -- across a vasuli move); later pieces are stamped when they were logged
  case when l.op = 'INSERT' then r.created_at else l.logged_at end
from removed r
join crate_transaction_log l on l.crate_transaction_id = r.id and l.delta <> 0
order by l.id;

-- 4. writers: plain inserts, one row per payload line
create or replace function create_crate_issue(p_payload jsonb)
returns setof crate_transaction
language sql
as $$
  insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type)
  select
    p_payload->>'vyapariId',
    (c->>'crate_id')::smallint,
    (c->>'count')::smallint,
    (p_payload->>'date')::date,
    null,
    'ISSUE'
  from jsonb_array_elements(p_payload->'crates') with ordinality as t(c, ord)
  order by ord
  returning *;
$$;

create or replace function create_crate_return(p_payload jsonb)
returns boolean
language sql
as $$
  with ins as (
    insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type)
    select
      p_payload->>'vyapariId',
      (c->>'crate_id')::smallint,
      -(c->>'count')::smallint,
      (p_payload->>'date')::date,
      null,
      'RETURN'
    from jsonb_array_elements(p_payload->'crates') with ordinality as t(c, ord)
    order by ord
    returning 1
  )
  select true from ins limit 1;
$$;

-- Sets a vyapari's MANUAL issue total for a crate on a date: that crate's manual
-- ISSUE entries are replaced by one row holding the new count (0 = removed),
-- keeping the earliest created_at. Crates absent from the payload, auction-linked
-- rows and the day's RETURN rows are untouched. To change one entry instead of
-- the day's total, use edit_crate_entry.
create or replace function edit_crate_summary(p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_vyapari_id text := p_payload->>'vyapariId';
  v_date date := (p_payload->>'date')::date;
  v_result jsonb;
begin
  with removed as (
    delete from crate_transaction ct
    using jsonb_array_elements(p_payload->'crates') as c
    where ct.vyapari_id = v_vyapari_id
      and ct.date = v_date
      and ct.txn_type = 'ISSUE'
      and ct.parent_id is null
      and ct.crate_id = (c->>'crate_id')::smallint
    returning ct.crate_id, ct.created_at
  )
  insert into crate_transaction (vyapari_id, crate_id, crate_count, date, parent_id, txn_type, created_at)
  select
    v_vyapari_id,
    (c->>'crate_id')::smallint,
    (c->>'count')::smallint,
    v_date,
    null,
    'ISSUE',
    coalesce((select min(r.created_at) from removed r where r.crate_id = (c->>'crate_id')::smallint), now())
  from jsonb_array_elements(p_payload->'crates') as c
  where (c->>'count')::int > 0;

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

-- Sets a vyapari's MANUAL return total per crate on a date (same replace-with-one
-- semantics as edit_crate_summary), or with newVyapariId moves those crates'
-- returns to another vyapari. A move onto a vyapari that already has returns for
-- the same crate that day answers with a CONFLICT preview until confirmMerge.
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
        abs(sum(ct.crate_count)) as existing_count,
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
      group by ct.crate_id, c.crate_name, (e->>'count')::int
      having sum(ct.crate_count) <> 0
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

  -- Replace the source vyapari's RETURN entries for the payload's crate_ids with
  -- one row per crate under the target (the same vyapari for a plain edit),
  -- carrying the earliest created_at so a correction does not restamp the entry.
  -- A count of 0 just clears the source; the target's own entries are left alone.
  with removed as (
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
    v_target,
    (c->>'crate_id')::smallint,
    -(c->>'count')::smallint,
    v_date,
    null,
    'RETURN',
    coalesce((select min(r.created_at) from removed r where r.crate_id = (c->>'crate_id')::smallint), now())
  from jsonb_array_elements(p_payload->'crates') as c
  where (c->>'count')::int > 0;

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

-- Edits ONE entry by id — any entry: manual or auction, ISSUE or RETURN.
-- `count` is the absolute number of crates (always positive; RETURN rows are
-- stored negative here); 0 deletes the entry. crate_id may change the crate type.
create or replace function edit_crate_entry(p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := (p_payload->>'id')::bigint;
  v_crate_id smallint := (p_payload->>'crate_id')::smallint;
  v_count int := (p_payload->>'count')::int;
  v_result jsonb;
begin
  if v_count = 0 then
    delete from crate_transaction where id = v_id;
    if not found then
      raise exception 'Crate entry % not found', v_id using errcode = '23503';
    end if;
    return jsonb_build_object('id', v_id, 'deleted', true);
  end if;

  update crate_transaction
  set crate_id = v_crate_id,
      crate_count = (case when txn_type = 'RETURN' then -v_count else v_count end)::smallint
  where id = v_id;

  if not found then
    raise exception 'Crate entry % not found', v_id using errcode = '23503';
  end if;

  select jsonb_build_object(
    'id', ct.id,
    'vyapari_id', ct.vyapari_id,
    'vyapari_name', v.name,
    'date', ct.date,
    'txn_type', ct.txn_type,
    'source', case when ct.parent_id is null then 'MANUAL' else 'AUCTION' end,
    'parent_id', ct.parent_id,
    'crate_id', ct.crate_id,
    'crate_name', c.crate_name,
    'count', abs(ct.crate_count),
    'created_at', ct.created_at
  )
  into v_result
  from crate_transaction ct
  join party v on v.party_id = ct.vyapari_id
  join crate c on c.id = ct.crate_id
  where ct.id = v_id;

  return v_result;
end;
$$;

-- Kept for the existing PUT /crate/auction-entry contract (auction rows only,
-- kisan_name in the response). The unique_violation branch is gone: entries no
-- longer collide when one changes crate type.
create or replace function edit_crate_auction_entry(p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := (p_payload->>'id')::bigint;
  v_crate_id smallint := (p_payload->>'crate_id')::smallint;
  v_count int := (p_payload->>'count')::int;
  v_result jsonb;
begin
  perform 1
  from crate_transaction
  where id = v_id
    and txn_type = 'ISSUE'
    and parent_id is not null
    and parent_id <> '';

  if not found then
    raise exception 'Auction crate entry % not found', v_id using errcode = '23503';
  end if;

  if v_count = 0 then
    delete from crate_transaction where id = v_id;
    return jsonb_build_object('id', v_id, 'deleted', true);
  end if;

  update crate_transaction
  set crate_id = v_crate_id,
      crate_count = v_count::smallint
  where id = v_id;

  select jsonb_build_object(
    'id', ct.id,
    'kisan_name', k.name,
    'vyapari_id', ct.vyapari_id,
    'vyapari_idNo', v.id_no,
    'vyapari_name', v.name,
    'crate_id', ct.crate_id,
    'crate_name', c.crate_name,
    'crate_count', ct.crate_count
  )
  into v_result
  from crate_transaction ct
  join auction a on a.auction_id = ct.parent_id::uuid
  join party k on k.party_id = a.kisan_id
  join party v on v.party_id = ct.vyapari_id
  join crate c on c.id = ct.crate_id
  where ct.id = v_id;

  return v_result;
end;
$$;

-- 5. readers that exposed log entries now expose the rows themselves

-- Crates ISSUED to each vyapari on a date, summed per crate across manual and
-- auction entries. Each crate carries `entries`: the rows behind crate_count,
-- oldest first; edit one with PUT /crate/entry using its id.
create or replace function get_crate_summary_by_date(p_date date)
returns jsonb
language sql
stable
as $$
  with per_crate as (
    select
      ct.vyapari_id,
      ct.crate_id,
      sum(ct.crate_count) as crate_count,
      min(ct.created_at) as created_at,
      jsonb_agg(
        jsonb_build_object(
          'id', ct.id,
          'count', ct.crate_count,
          'source', case when ct.parent_id is null then 'MANUAL' else 'AUCTION' end,
          'parent_id', ct.parent_id,
          'created_at', ct.created_at
        )
        order by ct.created_at, ct.id
      ) as entries
    from crate_transaction ct
    where ct.date = p_date
      and ct.txn_type = 'ISSUE'
    group by ct.vyapari_id, ct.crate_id
    having sum(ct.crate_count) <> 0
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
      pc.vyapari_id,
      p.name as vyapari_name,
      -- earliest issue of the day, across all crates/sources: "when this
      -- vyapari was first given crates" — clients sort on this for the report
      min(pc.created_at) as created_at,
      jsonb_agg(
        jsonb_build_object(
          'crate_id', pc.crate_id,
          'crate_name', c.crate_name,
          'crate_count', pc.crate_count,
          'created_at', pc.created_at,
          'entries', pc.entries
        )
        order by pc.crate_id
      ) as crates
    from per_crate pc
    join party p on p.party_id = pc.vyapari_id
    join crate c on c.id = pc.crate_id
    group by pc.vyapari_id, p.name
  ) t;
$$;

-- Every crate movement for a vyapari in a date range, one row per entry
-- (issues positive, returns negative), oldest first.
create or replace function get_crate_ledger(p_vyapari_id text, p_from_date date, p_to_date date)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ct.id,
        'date', ct.date,
        'crate_id', ct.crate_id,
        'crate_name', cr.crate_name,
        'crate_count', ct.crate_count,
        'txn_type', ct.txn_type,
        'source', case when ct.parent_id is null then 'MANUAL' else 'AUCTION' end,
        'parent_id', ct.parent_id,
        'created_at', ct.created_at
      )
      order by ct.date, ct.created_at, ct.id
    ),
    '[]'::jsonb
  )
  from crate_transaction ct
  join crate cr on cr.id = ct.crate_id
  where ct.vyapari_id = p_vyapari_id
    and ct.date between p_from_date and p_to_date
    and ct.crate_count <> 0;
$$;

