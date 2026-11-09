-- Auction writes v2: create / edit / edit-by-recreate / delete that are safe to
-- repeat and cannot drift party.owed_amount.
--
-- Apply AFTER the client's amount helper:
--   dev, his : db/auction_amount_his.sql  then this file
--   hmb      : db/auction_amount_hmb.sql  then this file
-- This file is client-neutral: every amount goes through auction_txn_amount().
-- Rollback: db/auction_write_v2_rollback_{his,hmb}.sql
--
-- What it fixes (see git history / PR for the investigation):
--  * Duplicates: the client now names every auction and lot (auctionId /
--    auctionTransactionId, UUIDs made when the lot is entered). A lot that is
--    already saved is skipped, so a timed-out POST that is retried, a double
--    tap, or a second tab re-posting the same queue cannot insert twice.
--    owed_amount only moves for rows this call actually inserted.
--  * Resurrection: deleted ids are remembered (auction_tombstone), so a late
--    retry of the original create does not bring a deleted lot back.
--  * Closing-balance drift on edits: an edit/delete must target the CURRENT
--    row (is_old = 'N'), under a row lock. A double-tapped or stale-screen edit
--    gets AUCTION_TXN_STALE (409) instead of subtracting the old amount twice.
--    edit-by-recreate refuses when its rows are gone instead of deleting
--    nothing and adding the new lots on top (the duplicate-on-resubmit bug).
--  * Wrong kisan: auction ids are fixed BEFORE insert, so lots can no longer
--    be attached to an auction by RETURNING order (which Postgres does not
--    guarantee).
--  * Bad rows: kisan must be a kisan, vyapari a vyapari, item must exist,
--    quantity/rate present and >= 0 -- AUCTION_VALIDATION (400) instead of
--    rows that vanish from the listing or move no money.
--  * Deadlocks: vyapari rows are locked in party_id order before anything is
--    written, so two devices saving for the same vyaparis queue instead of
--    deadlocking (a deadlock is a 500, and a 500 is a retry).
--
-- Error contract (prefix of the exception message; mapped in auction.repo.ts):
--   AUCTION_VALIDATION   -> 400
--   AUCTION_ID_CONFLICT  -> 409  id reused for different content / deleted auction
--   AUCTION_TXN_STALE    -> 409  row already edited or gone; client must reload
--   AUCTION_TXN_NOT_FOUND / 'Auction transaction not found' -> 404 (unchanged)
--   'Invalid vyapari id' -> 400 (unchanged)

begin;

-- ---------------------------------------------------------------------------
-- Ids of deleted lots and auctions, so a late retry cannot resurrect them.
-- ---------------------------------------------------------------------------
create table if not exists public.auction_tombstone (
  id         uuid primary key,
  kind       text not null check (kind in ('AUCTION', 'TXN')),
  deleted_at timestamptz not null default now()
);
alter table public.auction_tombstone enable row level security;

-- ---------------------------------------------------------------------------
-- Payload readers. Pure views over the (id-filled) payload, so every step of
-- auction_create_v2 reads the same rows.
-- ---------------------------------------------------------------------------
create or replace function public.auction_v2_auctions(p jsonb, p_device_id integer)
returns table (
  a_ord integer, auction_id uuid, kisan_id text, item_id text, total_bags integer,
  auction_date timestamp, crate_id smallint, device_id integer
)
language sql stable
as $$
  select a.o::integer,
         (a.obj->>'auctionId')::uuid,
         nullif(a.obj->>'kisan_id', ''),
         nullif(a.obj->>'item_id', ''),
         (a.obj->>'total_bags')::integer,
         (a.obj->>'auctionDate')::timestamp,
         (a.obj->>'crate_id')::smallint,
         coalesce((a.obj->>'device_id')::integer, p_device_id)
  from jsonb_array_elements(p) with ordinality as a(obj, o)
$$;

create or replace function public.auction_v2_items(p jsonb)
returns table (
  a_ord integer, b_ord integer, auction_id uuid, auction_transaction_id uuid,
  vyapari_id text, quantity numeric, rate numeric, chungi integer, bag integer,
  crate_count smallint, bag_wise_quantity text, header_date timestamp, item_date date
)
language sql stable
as $$
  select a.o::integer,
         b.o::integer,
         (a.obj->>'auctionId')::uuid,
         (b.bi->>'auctionTransactionId')::uuid,
         nullif(b.bi->>'vyapariId', ''),
         (b.bi->>'quantity')::numeric,
         (b.bi->>'rate')::numeric,
         coalesce((b.bi->>'chungi')::integer, 0),
         coalesce(b.bi->>'bags', b.bi->>'bag')::integer,
         coalesce((b.bi->>'crate_count')::smallint, 0),
         (select string_agg(q.v, ',' order by q.vo)
            from jsonb_array_elements_text(
                   case when jsonb_typeof(b.bi->'bagWiseQuantity') = 'array'
                        then b.bi->'bagWiseQuantity' else '[]'::jsonb end
                 ) with ordinality as q(v, vo)),
         (a.obj->>'auctionDate')::timestamp,
         (b.bi->>'auctionDate')::date
  from jsonb_array_elements(p) with ordinality as a(obj, o)
  cross join lateral jsonb_array_elements(a.obj->'buyItems') with ordinality as b(bi, o)
$$;

-- ---------------------------------------------------------------------------
-- CREATE
-- ---------------------------------------------------------------------------
create or replace function public.auction_create_v2(p_payload jsonb, p_device_id integer)
returns jsonb
language plpgsql
as $fn$
declare
  v_payload jsonb;
  v_bad     text;
  v_items   jsonb;  -- lots to insert now (not saved, not deleted)
  v_ins     jsonb;  -- lots actually inserted by this call
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'array' or jsonb_array_length(p_payload) = 0 then
    raise exception 'AUCTION_VALIDATION: payload must be a non-empty array of auctions';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload) as a(obj)
    where case when jsonb_typeof(a.obj->'buyItems') = 'array'
               then jsonb_array_length(a.obj->'buyItems') = 0
               else true end
  ) then
    raise exception 'AUCTION_VALIDATION: every auction needs a non-empty buyItems array';
  end if;

  -- Fix every id up front. Callers that send their own (the auction app) keep
  -- them; older callers get fresh ones, exactly as before.
  select jsonb_agg(
           a.obj || jsonb_build_object(
             'auctionId', coalesce(nullif(a.obj->>'auctionId', ''), gen_random_uuid()::text),
             'buyItems', (
               select jsonb_agg(
                        b.bi || jsonb_build_object(
                          'auctionTransactionId',
                          coalesce(nullif(b.bi->>'auctionTransactionId', ''), gen_random_uuid()::text))
                        order by b.o)
               from jsonb_array_elements(a.obj->'buyItems') with ordinality as b(bi, o)))
           order by a.o)
    into v_payload
    from jsonb_array_elements(p_payload) with ordinality as a(obj, o);

  -- ids must be unique within the request
  select string_agg(d.id::text, ', ') into v_bad
    from (select auction_transaction_id as id from auction_v2_items(v_payload)
          group by 1 having count(*) > 1) d;
  if v_bad is not null then
    raise exception 'AUCTION_VALIDATION: auctionTransactionId repeated in one request: %', v_bad;
  end if;
  select string_agg(d.id::text, ', ') into v_bad
    from (select auction_id as id from auction_v2_auctions(v_payload, p_device_id)
          group by 1 having count(*) > 1) d;
  if v_bad is not null then
    raise exception 'AUCTION_VALIDATION: auctionId repeated in one request: %', v_bad;
  end if;

  -- auction-level checks
  select string_agg(format('auction %s: %s', x.a_ord, x.why), '; ' order by x.a_ord) into v_bad
    from (
      select a.a_ord,
             case
               when a.kisan_id is null then 'kisanId missing'
               when not exists (select 1 from party p where p.party_id = a.kisan_id and p.party_type = 0)
                 then format('kisan %s not found', a.kisan_id)
               when a.item_id is null then 'itemId missing'
               when not exists (select 1 from items i where i.item_id = a.item_id)
                 then format('item %s not found', a.item_id)
               when a.device_id is null then 'deviceId missing'
             end as why
      from auction_v2_auctions(v_payload, p_device_id) a
    ) x
   where x.why is not null;
  if v_bad is not null then
    raise exception 'AUCTION_VALIDATION: %', v_bad;
  end if;

  -- lot-level checks
  select string_agg(format('auction %s lot %s: %s', x.a_ord, x.b_ord, x.why), '; ' order by x.a_ord, x.b_ord)
    into v_bad
    from (
      select i.a_ord, i.b_ord,
             case
               when i.vyapari_id is null then 'vyapariId missing'
               when not exists (select 1 from party p where p.party_id = i.vyapari_id and p.party_type = 1)
                 then format('vyapari %s not found', i.vyapari_id)
               when i.quantity is null or i.quantity < 0 then 'quantity must be a number >= 0'
               when i.rate is null or i.rate < 0 then 'rate must be a number >= 0'
             end as why
      from auction_v2_items(v_payload) i
    ) x
   where x.why is not null;
  if v_bad is not null then
    raise exception 'AUCTION_VALIDATION: %', v_bad;
  end if;

  -- Lock every buyer, in a fixed order, BEFORE writing. Two devices selling to
  -- the same vyaparis now queue here instead of deadlocking later.
  perform 1 from party
    where party_id in (select vyapari_id from auction_v2_items(v_payload))
    order by party_id
    for no key update;

  -- An id that is already saved must be the same thing it was saved as.
  select string_agg(a.auction_id::text, ', ') into v_bad
    from auction_v2_auctions(v_payload, p_device_id) a
    join auction x on x.auction_id = a.auction_id
   where x.kisan_id is distinct from a.kisan_id or x.item_id is distinct from a.item_id;
  if v_bad is not null then
    raise exception 'AUCTION_ID_CONFLICT: auctionId % is already saved for a different kisan/item', v_bad;
  end if;

  select string_agg(i.auction_transaction_id::text, ', ') into v_bad
    from auction_v2_items(v_payload) i
    join auction_transaction t on t.auction_transaction_id = i.auction_transaction_id
   where t.auction_id is distinct from i.auction_id
      or t.vyapari_id is distinct from i.vyapari_id
      or t.quantity   is distinct from i.quantity
      or t.rate       is distinct from i.rate
      or coalesce(t.chungi, 0) <> i.chungi;
  if v_bad is not null then
    raise exception 'AUCTION_ID_CONFLICT: auctionTransactionId % is already saved with different values', v_bad;
  end if;

  -- Lots still to insert: not saved yet and not deleted since.
  select coalesce(jsonb_agg(to_jsonb(i) order by i.a_ord, i.b_ord), '[]'::jsonb) into v_items
    from auction_v2_items(v_payload) i
   where not exists (select 1 from auction_transaction t where t.auction_transaction_id = i.auction_transaction_id)
     and not exists (select 1 from auction_tombstone d where d.id = i.auction_transaction_id);

  select string_agg(distinct x.auction_id::text, ', ') into v_bad
    from jsonb_to_recordset(v_items) as x(auction_id uuid)
    join auction_tombstone d on d.id = x.auction_id
   where not exists (select 1 from auction a where a.auction_id = x.auction_id);
  if v_bad is not null then
    raise exception 'AUCTION_ID_CONFLICT: auction % was deleted; new lots need a new auctionId', v_bad;
  end if;

  -- auctions that have something new to hold
  insert into auction (auction_id, kisan_id, item_id, total_bags, auction_date, device_id)
  select a.auction_id, a.kisan_id, a.item_id, a.total_bags,
         coalesce(a.auction_date, (now() at time zone 'Asia/Kolkata')), a.device_id
    from auction_v2_auctions(v_payload, p_device_id) a
   where a.auction_id in (select x.auction_id from jsonb_to_recordset(v_items) as x(auction_id uuid))
   order by a.a_ord
  on conflict (auction_id) do nothing;

  -- the lots; RETURNING yields only rows this call inserted
  with ins as (
    insert into auction_transaction (
      auction_transaction_id, auction_id, auction_date, vyapari_id, quantity, bag,
      rate, chungi, bag_wise_quantity, validated, is_old
    )
    select x.auction_transaction_id, x.auction_id,
           coalesce(x.header_date, (now() at time zone 'Asia/Kolkata')),
           x.vyapari_id, x.quantity, x.bag, x.rate, x.chungi, x.bag_wise_quantity, 'N', 'N'
      from jsonb_to_recordset(v_items) as x(
             a_ord integer, b_ord integer, auction_id uuid, auction_transaction_id uuid,
             vyapari_id text, quantity numeric, rate numeric, chungi integer, bag integer,
             bag_wise_quantity text, header_date timestamp)
     order by x.a_ord, x.b_ord   -- txn_no is assigned in this order
    on conflict (auction_transaction_id) do nothing
    returning auction_transaction_id, auction_id, vyapari_id, rate, chungi, quantity, bag
  )
  select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_ins from ins;

  -- crates issued with the lots (append-only, one row per lot) -- new lots only
  insert into crate_transaction (vyapari_id, crate_id, crate_count, parent_id, date, txn_type)
  select x.vyapari_id, a.crate_id, x.crate_count, x.auction_id::text, x.item_date, 'ISSUE'
    from jsonb_to_recordset(v_items) as x(
           auction_id uuid, auction_transaction_id uuid, vyapari_id text,
           crate_count smallint, item_date date)
    join auction_v2_auctions(v_payload, p_device_id) a on a.auction_id = x.auction_id
   where x.crate_count > 0
     and x.auction_transaction_id in (
           select y.auction_transaction_id from jsonb_to_recordset(v_ins) as y(auction_transaction_id uuid));

  -- money moves only for what was inserted
  update party p
     set owed_amount = coalesce(p.owed_amount, 0) + t.amount
    from (
      select y.vyapari_id, sum(auction_txn_amount(y.rate, y.chungi, y.quantity, y.bag)) as amount
        from jsonb_to_recordset(v_ins) as y(vyapari_id text, rate numeric, chungi numeric, quantity numeric, bag numeric)
       group by y.vyapari_id
    ) t
   where p.party_id = t.vyapari_id;

  return jsonb_build_object(
    'created', jsonb_array_length(v_ins),
    'alreadySaved', (select count(*) from auction_v2_items(v_payload)) - jsonb_array_length(v_ins),
    'auctions', (
      select jsonb_agg(
               jsonb_build_object(
                 'auctionId', a.auction_id,
                 'transactions', (
                   select jsonb_agg(
                            jsonb_build_object(
                              'auctionTransactionId', i.auction_transaction_id,
                              'status', case
                                when exists (select 1 from jsonb_to_recordset(v_ins) as y(auction_transaction_id uuid)
                                              where y.auction_transaction_id = i.auction_transaction_id) then 'CREATED'
                                when exists (select 1 from auction_tombstone d where d.id = i.auction_transaction_id) then 'DELETED'
                                else 'ALREADY_SAVED' end)
                            order by i.b_ord)
                     from auction_v2_items(v_payload) i
                    where i.a_ord = a.a_ord))
               order by a.a_ord)
        from auction_v2_auctions(v_payload, p_device_id) a)
  );
end;
$fn$;

-- Old name, same behaviour, for anything still calling it.
create or replace function public.create_auction_bulk_with_crate(p_payload jsonb, p_device_id integer)
returns boolean
language plpgsql
as $fn$
begin
  perform auction_create_v2(p_payload, p_device_id);
  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- DELETE
-- ---------------------------------------------------------------------------
create or replace function public.delete_auction_transactions("auctionTransactionIds" uuid[])
returns boolean
language plpgsql
as $fn$
declare
  v_ids                uuid[] := "auctionTransactionIds";
  v_chain_ids          uuid[];
  v_empty_auction_ids  uuid[];
  v_stale              text;
begin
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'auctionTransactionIds cannot be empty';
  end if;

  -- lock what we are about to delete; a concurrent edit of the same rows waits
  perform 1 from auction_transaction
    where auction_transaction_id = any(v_ids)
    order by auction_transaction_id
    for update;
  if not found then
    raise exception 'AUCTION_TXN_NOT_FOUND: none of the requested auction transactions exist';
  end if;

  -- deleting a row that an edit already replaced would leave the live entry
  -- standing while the user believes it is gone
  select string_agg(auction_transaction_id::text, ', ') into v_stale
    from auction_transaction
   where auction_transaction_id = any(v_ids) and is_old = 'Y';
  if v_stale is not null then
    raise exception 'AUCTION_TXN_STALE: % already replaced by an edit; reload and delete the current entry', v_stale;
  end if;

  -- the requested rows plus their edit history (walk up parent_id)
  with recursive chain as (
    select at.auction_transaction_id, at.parent_id
      from auction_transaction at
     where at.auction_transaction_id = any(v_ids)
    union
    select p.auction_transaction_id, p.parent_id
      from auction_transaction p
      join chain c on p.auction_transaction_id::text = c.parent_id
  )
  select array_agg(auction_transaction_id) into v_chain_ids from chain;

  perform 1 from party
    where party_id in (select vyapari_id from auction_transaction
                        where auction_transaction_id = any(v_chain_ids) and is_old = 'N')
    order by party_id
    for no key update;

  update party p
     set owed_amount = coalesce(p.owed_amount, 0) - sub.amount
    from (
      select at.vyapari_id,
             coalesce(sum(auction_txn_amount(at.rate, at.chungi, at.quantity, at.bag)), 0) as amount
        from auction_transaction at
       where at.auction_transaction_id = any(v_chain_ids)
         and at.is_old = 'N'
       group by at.vyapari_id
    ) sub
   where p.party_id = sub.vyapari_id;

  select array(
    select a.auction_id
      from auction a
     where a.auction_id in (select at.auction_id from auction_transaction at
                             where at.auction_transaction_id = any(v_chain_ids))
       and not exists (select 1 from auction_transaction at2
                        where at2.auction_id = a.auction_id
                          and at2.auction_transaction_id <> all(v_chain_ids))
  ) into v_empty_auction_ids;

  delete from auction_transaction where auction_transaction_id = any(v_chain_ids);
  insert into auction_tombstone (id, kind)
    select unnest(v_chain_ids), 'TXN' on conflict (id) do nothing;

  if v_empty_auction_ids is not null and array_length(v_empty_auction_ids, 1) > 0 then
    delete from auction where auction_id = any(v_empty_auction_ids);
    insert into auction_tombstone (id, kind)
      select unnest(v_empty_auction_ids), 'AUCTION' on conflict (id) do nothing;
  end if;

  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- EDIT ONE LOT
-- ---------------------------------------------------------------------------
drop function if exists public.edit_auction_transaction(uuid, integer, text, integer, text, numeric, numeric);

create or replace function public.edit_auction_transaction(
  p_auction_transaction_id     uuid,
  p_bag                        integer,
  p_bag_wise_quantity          text,
  p_chungi                     integer,
  p_new_vyapari_id             text,
  p_quantity                   numeric,
  p_rate                       numeric,
  p_new_auction_transaction_id uuid default null
) returns jsonb
language plpgsql
as $fn$
declare
  v_old     auction_transaction%rowtype;
  v_dup     auction_transaction%rowtype;
  v_new_id  uuid := coalesce(p_new_auction_transaction_id, gen_random_uuid());
begin
  -- retry of an edit that already went through: the replacement row exists
  if p_new_auction_transaction_id is not null then
    select * into v_dup from auction_transaction
     where auction_transaction_id = p_new_auction_transaction_id;
    if found then
      if v_dup.parent_id is distinct from p_auction_transaction_id::text then
        raise exception 'AUCTION_ID_CONFLICT: newAuctionTransactionId % already belongs to another entry',
          p_new_auction_transaction_id;
      end if;
      return jsonb_build_object('auctionTransactionId', v_dup.auction_transaction_id, 'alreadySaved', true);
    end if;
    if exists (select 1 from auction_tombstone where id = p_new_auction_transaction_id) then
      return jsonb_build_object('auctionTransactionId', p_new_auction_transaction_id, 'alreadySaved', true, 'deleted', true);
    end if;
  end if;

  select * into v_old from auction_transaction
   where auction_transaction_id = p_auction_transaction_id
   for update;
  if not found then
    raise exception 'Auction transaction not found';
  end if;
  if v_old.is_old = 'Y' then
    raise exception 'AUCTION_TXN_STALE: transaction % was already edited; reload and edit the current entry',
      p_auction_transaction_id;
  end if;

  if not exists (select 1 from party where party_id = p_new_vyapari_id and party_type = 1) then
    raise exception 'Invalid vyapari id';
  end if;
  if p_quantity is null or p_quantity < 0 or p_rate is null or p_rate < 0 then
    raise exception 'AUCTION_VALIDATION: quantity and rate must be numbers >= 0';
  end if;

  perform 1 from party
    where party_id in (v_old.vyapari_id, p_new_vyapari_id)
    order by party_id
    for no key update;

  update auction_transaction set is_old = 'Y'
   where auction_transaction_id = p_auction_transaction_id;

  insert into auction_transaction (
    auction_transaction_id, auction_date, auction_id, bag, quantity, rate, chungi,
    vyapari_id, parent_id, bag_wise_quantity, is_old
  ) values (
    v_new_id, v_old.auction_date, v_old.auction_id, p_bag, p_quantity, p_rate, coalesce(p_chungi, 0),
    p_new_vyapari_id, p_auction_transaction_id::text, p_bag_wise_quantity, 'N'
  );

  update party
     set owed_amount = coalesce(owed_amount, 0)
                       - auction_txn_amount(v_old.rate, v_old.chungi, v_old.quantity, v_old.bag)
   where party_id = v_old.vyapari_id;
  update party
     set owed_amount = coalesce(owed_amount, 0)
                       + auction_txn_amount(p_rate, coalesce(p_chungi, 0), p_quantity, p_bag)
   where party_id = p_new_vyapari_id;

  return jsonb_build_object('auctionTransactionId', v_new_id, 'alreadySaved', false);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- EDIT AUCTION (replace lots by delete + re-add, in one transaction)
-- ---------------------------------------------------------------------------
create or replace function public.edit_auction_by_recreate2(auction_transaction_ids uuid[], new_payload jsonb)
returns boolean
language plpgsql
as $fn$
declare
  v_ids     uuid[];
  v_given   integer;
  v_live    integer;
  v_new_ids uuid[];
  v_reused  text;
begin
  if auction_transaction_ids is null or array_length(auction_transaction_ids, 1) is null then
    raise exception 'auction_transaction_ids cannot be empty';
  end if;
  -- an empty array is valid: the edit dialog sends [] when every lot of the
  -- auction was removed, i.e. "delete these, add nothing" (as on the old server)
  if new_payload is null or jsonb_typeof(new_payload) <> 'array' then
    raise exception 'AUCTION_VALIDATION: new_payload must be an array of auctions';
  end if;

  select array_agg(distinct x) into v_ids from unnest(auction_transaction_ids) as x;
  v_given := cardinality(v_ids);

  perform 1 from auction_transaction
    where auction_transaction_id = any(v_ids)
    order by auction_transaction_id
    for update;
  select count(*) into v_live from auction_transaction
   where auction_transaction_id = any(v_ids) and is_old = 'N';

  select array_agg((bi->>'auctionTransactionId')::uuid) into v_new_ids
    from jsonb_array_elements(new_payload) as a(obj)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.obj->'buyItems') = 'array' then a.obj->'buyItems' else '[]'::jsonb end
    ) as bi;

  if v_live < v_given then
    -- Rows to replace are gone or already edited. If every new lot of this
    -- request is already saved, this is a retry of an edit that went through:
    -- succeed without touching anything. Otherwise the screen was stale.
    if v_new_ids is not null
       and not exists (select 1 from unnest(v_new_ids) as n where n is null)
       and not exists (
         select 1 from unnest(v_new_ids) as n
          where not exists (select 1 from auction_transaction t where t.auction_transaction_id = n)
            and not exists (select 1 from auction_tombstone d where d.id = n)) then
      return true;
    end if;
    raise exception 'AUCTION_TXN_STALE: % of % entries to replace no longer exist or were already edited; reload and try again',
      v_given - v_live, v_given;
  end if;

  -- new lots must not reuse an id that is saved or deleted (they would be
  -- skipped as "already saved" and the edit would silently lose them)
  select string_agg(n::text, ', ') into v_reused
    from unnest(v_new_ids) as n
   where n is not null
     and (exists (select 1 from auction_transaction t where t.auction_transaction_id = n)
          or exists (select 1 from auction_tombstone d where d.id = n));
  if v_reused is not null then
    raise exception 'AUCTION_VALIDATION: new entries need new auctionTransactionIds (% already used)', v_reused;
  end if;

  perform delete_auction_transactions(v_ids);
  if jsonb_array_length(new_payload) > 0 then
    perform auction_create_v2(
      new_payload,
      coalesce((new_payload->0->>'device_id')::integer, (new_payload->0->>'deviceId')::integer)
    );
  end if;
  return true;
end;
$fn$;

commit;

notify pgrst, 'reload schema';
