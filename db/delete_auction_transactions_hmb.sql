-- delete_auction_transactions — HMB variant.
-- Owed formula (HMB rule): rate * quantity + chungi * bag.
-- Reverses owed only for ACTIVE rows (is_old = 'N'): edited lots keep their
-- superseded history rows (is_old = 'Y', linked via parent_id), whose amounts
-- were already replaced in owed_amount by the edit RPCs.
-- Deletes the requested rows plus their parent_id history chain, then removes
-- auction headers left empty. Crate movements are NOT reversed.
create or replace function delete_auction_transactions("auctionTransactionIds" uuid[])
returns boolean
language plpgsql
as $$
declare
  v_ids uuid[] := "auctionTransactionIds";
  v_chain_ids uuid[];
  v_empty_auction_ids uuid[];
begin
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'auctionTransactionIds cannot be empty';
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
           coalesce(sum(at.rate * at.quantity + coalesce(at.chungi, 0) * coalesce(at.bag, 0)), 0) as total_amount
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
$$;
