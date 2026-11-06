-- The one place the hmb client's lot amount is defined. Apply BEFORE
-- db/auction_write_v2.sql (which calls it) on hmb ONLY.
-- dev/his use db/auction_amount_his.sql. Never apply this one there.
--
-- hmb: rate * quantity + chungi * bag   (chungi is charged per bag, not per kg)

create or replace function public.auction_txn_amount(
  p_rate numeric, p_chungi numeric, p_quantity numeric, p_bag numeric
) returns numeric
language sql immutable parallel safe
as $$
  select coalesce(p_rate, 0) * coalesce(p_quantity, 0) + coalesce(p_chungi, 0) * coalesce(p_bag, 0)
$$;
