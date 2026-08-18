-- delete_auction_transactions: fail loudly when NONE of the requested ids
-- exist, instead of silently returning true (observed twice as a
-- 200-but-row-survived delete). Partial matches still delete the existing
-- rows: the end state matches intent, and a full retry after success now
-- gets a clean 404 (mapped in src/auction/auction.repo.ts) instead of a lie.
-- GENERATED from the dev database's own definition; dev/his formula
-- (rate + chungi) * quantity. hmb variant in the _hmb file -- NEVER cross-apply.

CREATE OR REPLACE FUNCTION public.delete_auction_transactions("auctionTransactionIds" uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare
  v_ids uuid[] := "auctionTransactionIds";
  v_chain_ids uuid[];
  v_empty_auction_ids uuid[];
begin
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'auctionTransactionIds cannot be empty';
  end if;

  -- silent no-op guard: deleting only ids that do not exist must fail
  -- loudly, not return true (observed twice: 200-but-row-survived deletes).
  -- Ids that partially match still delete the existing rows -- the end state
  -- matches intent and full-retry idempotence is preserved via this 404.
  if not exists (
    select 1 from auction_transaction
    where auction_transaction_id = any(v_ids)
  ) then
    raise exception 'AUCTION_TXN_NOT_FOUND: none of the requested auction transactions exist';
  end if;

  -- requested rows + their edit-history ancestors (parent_id chain)
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

  -- 1. reverse owed amount for active rows only
  update party p
  set owed_amount = coalesce(p.owed_amount, 0) - sub.total_amount
  from (
    select at.vyapari_id,
           coalesce(sum((at.rate + coalesce(at.chungi, 0)) * at.quantity), 0) as total_amount
    from auction_transaction at
    where at.auction_transaction_id = any(v_chain_ids)
      and at.is_old = 'N'
    group by at.vyapari_id
  ) sub
  where p.party_id = sub.vyapari_id;

  -- 2. collect auction headers that will become empty
  select array(
    select a.auction_id
    from auction a
    where a.auction_id in (
      select at.auction_id
      from auction_transaction at
      where at.auction_transaction_id = any(v_chain_ids)
    )
    and not exists (
      select 1
      from auction_transaction at2
      where at2.auction_id = a.auction_id
        and at2.auction_transaction_id <> all(v_chain_ids)
    )
  ) into v_empty_auction_ids;

  -- 3. delete the transactions (requested + history chain)
  delete from auction_transaction
  where auction_transaction_id = any(v_chain_ids);

  -- 4. delete now-empty auction headers
  if v_empty_auction_ids is not null and array_length(v_empty_auction_ids, 1) > 0 then
    delete from auction
    where auction_id = any(v_empty_auction_ids);
  end if;

  return true;
end;
$function$

;
