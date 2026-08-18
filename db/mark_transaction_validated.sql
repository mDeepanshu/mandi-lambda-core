-- Marks a vyapari's auction transactions as validated ('Y') within a date
-- range. Called by PATCH /auction/mark-transaction-validated via PostgREST;
-- argument names must match the lambda's rpc payload exactly.
-- validated is a varchar 'N'/'Y' checkpoint flag read by
-- get_unvalidated_start_date. Returns the number of rows updated.
create or replace function mark_transaction_validated(
  from_date date,
  to_date date,
  vyapari_id text
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  if from_date is null or to_date is null or vyapari_id is null then
    raise exception 'from_date, to_date and vyapari_id are required';
  end if;

  update auction_transaction at
  set validated = 'Y'
  where at.vyapari_id = mark_transaction_validated.vyapari_id
    and at.auction_date::date between from_date and to_date
    and at.validated = 'N';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
