-- Edits one auction-issued crate entry, identified by its crate_transaction id
-- (the 'id' returned by get_crate_auction_list). count is the absolute new count;
-- count 0 deletes the entry. crate_id may be changed to move the entry to a
-- different crate type.
create or replace function edit_crate_auction_entry(p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := (p_payload->>'id')::bigint;
  v_crate_id smallint := (p_payload->>'crate_id')::smallint;
  v_count int := (p_payload->>'count')::int;
  v_row crate_transaction;
  v_result jsonb;
begin
  select * into v_row
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

  begin
    update crate_transaction
    set crate_id = v_crate_id,
        crate_count = v_count::smallint
    where id = v_id;
  exception
    when unique_violation then
      -- this pairing already has an entry for the target crate type; merging the
      -- two counts is not something we can decide here
      raise exception 'This kisan/vyapari pairing already has an entry for that crate type — edit that entry instead'
        using errcode = '23505';
  end;

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
