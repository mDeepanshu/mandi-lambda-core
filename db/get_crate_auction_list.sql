-- Crates issued through auctions on a date: one row per crate type per
-- kisan/vyapari pairing. crate_transaction.parent_id holds the auction_id, which
-- is what carries the kisan (auction.kisan_id).
--
-- Only auction-linked rows appear (parent_id not null); manually issued crates
-- are listed by get_crate_summary_by_date. 'id' is the crate_transaction row id —
-- it is what edit_crate_auction_entry takes.
create or replace function get_crate_auction_list(p_date date)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ct.id,
        'kisan_name', k.name,
        'vyapari_id', ct.vyapari_id,
        'vyapari_idNo', v.id_no,
        'vyapari_name', v.name,
        'crate_id', ct.crate_id,
        'crate_name', c.crate_name,
        'crate_count', ct.crate_count
      )
      order by k.name, v.name, ct.crate_id
    ),
    '[]'::jsonb
  )
  from crate_transaction ct
  join auction a on a.auction_id = ct.parent_id::uuid
  join party k on k.party_id = a.kisan_id
  join party v on v.party_id = ct.vyapari_id
  join crate c on c.id = ct.crate_id
  where ct.date = p_date
    and ct.txn_type = 'ISSUE'
    and ct.parent_id is not null
    and ct.parent_id <> ''
    and ct.crate_count <> 0;
$$;
