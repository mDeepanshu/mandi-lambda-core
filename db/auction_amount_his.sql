-- The one place the dev/his client's lot amount is defined. Apply BEFORE
-- db/auction_write_v2.sql (which calls it) on dev and his.
-- hmb has a different formula: db/auction_amount_hmb.sql. Never apply this one there.
--
-- dev/his: (rate + chungi) * quantity

create or replace function public.auction_txn_amount(
  p_rate numeric, p_chungi numeric, p_quantity numeric, p_bag numeric
) returns numeric
language sql immutable parallel safe
as $$
  select (coalesce(p_rate, 0) + coalesce(p_chungi, 0)) * coalesce(p_quantity, 0)
$$;
