-- Rollback of db/auction_write_v2.sql for hmb: restores the exact
-- definitions that were live on 2026-11-07 (dumped with pg_get_functiondef).
-- auction_tombstone is kept (harmless, and it records what was deleted).
begin;
drop function if exists public.edit_auction_transaction(uuid, integer, text, integer, text, numeric, numeric, uuid);

CREATE OR REPLACE FUNCTION public.create_auction_bulk_with_crate(p_payload jsonb, p_device_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN

  WITH auction_data AS (
    SELECT
      auction_obj,
      ord,
      (auction_obj->>'kisan_id') AS kisan_id,
      (auction_obj->>'item_id') AS item_id,
      (auction_obj->>'total_bags')::int AS total_bags,
      (auction_obj->>'auctionDate')::timestamp AS auction_date,
      (auction_obj->>'crate_id')::smallint AS crate_id,
      COALESCE(
        (auction_obj->>'device_id')::int,
        p_device_id
      ) AS device_id
    FROM jsonb_array_elements(p_payload)
    WITH ORDINALITY AS t(auction_obj, ord)
  ),

  inserted_auction AS (
    INSERT INTO auction (
      kisan_id,
      item_id,
      total_bags,
      auction_date,
      device_id
    )
    SELECT
      kisan_id,
      item_id,
      total_bags,
      auction_date,
      device_id
    FROM auction_data
    ORDER BY ord
    RETURNING auction_id
  ),

  auction_with_ord AS (
    SELECT
      ia.auction_id,
      ad.auction_obj,
      ad.crate_id,
      ad.ord
    FROM (
      SELECT auction_id,
             ROW_NUMBER() OVER () AS rn
      FROM inserted_auction
    ) ia
    JOIN (
      SELECT auction_obj,
             ord,
             crate_id,
             ROW_NUMBER() OVER (ORDER BY ord) AS rn
      FROM auction_data
    ) ad
    ON ia.rn = ad.rn
  ),

  buy_items AS (
    SELECT
      awo.auction_id,
      (awo.auction_obj->>'auctionDate')::timestamp AS header_auction_date,
      awo.crate_id,
      (bi->>'vyapariId') AS vyapari_id,
      (bi->>'quantity')::numeric AS quantity,
      (bi->>'rate')::numeric AS rate,
      COALESCE((bi->>'chungi')::int, 0) AS chungi,
      (bi->>'bags')::int AS bag,
      COALESCE((bi->>'crate_count')::smallint, 0) AS crate_count,
      (bi->>'auctionDate')::date AS auction_date,
      (
        SELECT string_agg(value, ',')
        FROM jsonb_array_elements_text(bi->'bagWiseQuantity')
      ) AS bag_wise_quantity
    FROM auction_with_ord awo
    CROSS JOIN LATERAL jsonb_array_elements(awo.auction_obj->'buyItems') AS bi
  ),

  inserted_transactions AS (
    INSERT INTO auction_transaction (
      auction_id,
      auction_date,
      vyapari_id,
      quantity,
      bag,
      rate,
      chungi,
      bag_wise_quantity,
      validated,
      is_old
    )
    SELECT
      auction_id,
      COALESCE(header_auction_date, (now() AT TIME ZONE 'Asia/Kolkata')),
      vyapari_id,
      quantity,
      bag,
      rate,
      chungi,
      bag_wise_quantity,
      'N',
      'N'
    FROM buy_items
    RETURNING vyapari_id, rate, quantity, chungi, bag
  ),

  crate_insert AS (
    -- append-only: one crate_transaction row per buyItem that carried crates
    INSERT INTO crate_transaction (
      vyapari_id,
      crate_id,
      crate_count,
      parent_id,
      date,
      txn_type
    )
    SELECT
      vyapari_id,
      crate_id,
      crate_count,
      auction_id::text AS parent_id,
      auction_date,
      'ISSUE'
    FROM buy_items
    WHERE crate_count > 0
  )

  UPDATE party p
  SET owed_amount = COALESCE(p.owed_amount, 0) + t.total_amount
  FROM (
    SELECT
      vyapari_id,
      SUM(rate * quantity + COALESCE(chungi, 0) * COALESCE(bag, 0)) AS total_amount
    FROM inserted_transactions
    GROUP BY vyapari_id
  ) t
  WHERE p.party_id = t.vyapari_id;

  RETURN true;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.edit_auction_transaction(p_auction_transaction_id uuid, p_bag integer, p_bag_wise_quantity text, p_chungi integer, p_new_vyapari_id text, p_quantity numeric, p_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
AS $function$DECLARE
    old_tx auction_transaction%ROWTYPE;
    old_amount NUMERIC;
    new_amount NUMERIC;
    new_vyapari_uuid TEXT;
BEGIN
    -- 1️⃣ Fetch parent transaction
    SELECT *
    INTO old_tx
    FROM auction_transaction
    WHERE auction_transaction_id = p_auction_transaction_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Auction transaction not found';
    END IF;

    SELECT party_id
    INTO new_vyapari_uuid
    FROM party
    WHERE party_id = p_new_vyapari_id; -- 👈 CHANGE THIS COLUMN NAME

    IF new_vyapari_uuid IS NULL THEN
        RAISE EXCEPTION 'Invalid vyapari id';
    END IF;

    -- 3️⃣ Mark old + children as OLD
    UPDATE auction_transaction
    SET is_old = 'Y'
    WHERE (
        auction_transaction_id = p_auction_transaction_id
        OR parent_id = p_auction_transaction_id::text
    );

    -- 4️⃣ Calculate amounts
    old_amount := old_tx.rate * old_tx.quantity + COALESCE(old_tx.chungi, 0) * COALESCE(old_tx.bag, 0);
    new_amount := p_rate * p_quantity + COALESCE(p_chungi, 0) * COALESCE(p_bag, 0);

    -- 5️⃣ Insert new transaction
    INSERT INTO auction_transaction (
        auction_date,
        auction_id,
        bag,
        quantity,
        rate,
        chungi,
        vyapari_id,
        parent_id,
        bag_wise_quantity,
        is_old
    )
    VALUES (
        old_tx.auction_date,
        old_tx.auction_id,
        p_bag,
        p_quantity,
        p_rate,
        p_chungi,
        new_vyapari_uuid,
        p_auction_transaction_id::text,
        p_bag_wise_quantity,
        'N'
    );

    -- 6️⃣ Update party balances
    UPDATE party
    SET owed_amount =
        COALESCE(owed_amount, 0)
        + CASE
            WHEN party_id = old_tx.vyapari_id
                 AND old_tx.vyapari_id <> new_vyapari_uuid
                THEN -old_amount

            WHEN party_id = new_vyapari_uuid
                 AND old_tx.vyapari_id <> new_vyapari_uuid
                THEN new_amount

            WHEN party_id = new_vyapari_uuid
                 AND old_tx.vyapari_id = new_vyapari_uuid
                THEN (new_amount - old_amount)

            ELSE 0
          END
    WHERE party_id IN (old_tx.vyapari_id, new_vyapari_uuid);

END;$function$
;

CREATE OR REPLACE FUNCTION public.edit_auction_by_recreate2(auction_transaction_ids uuid[], new_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$DECLARE
    deleted_auction_ids UUID[];
    in_device_id INTEGER;
BEGIN

    -- Validate input
    IF auction_transaction_ids IS NULL OR array_length(auction_transaction_ids,1) IS NULL THEN
        RAISE EXCEPTION 'auction_transaction_ids cannot be empty';
    END IF;

    IF new_payload IS NULL THEN
        RAISE EXCEPTION 'new_payload cannot be NULL';
    END IF;

    -------------------------------------------------------
    -- 1️⃣ Reverse owed amount
    -------------------------------------------------------
    UPDATE party p
    SET owed_amount = p.owed_amount - sub.total_amount
    FROM (
        SELECT
            at.vyapari_id,
            COALESCE(SUM(at.rate * at.quantity + COALESCE(at.chungi, 0) * COALESCE(at.bag, 0)),0) AS total_amount
        FROM auction_transaction at
        WHERE at.auction_transaction_id = ANY(auction_transaction_ids)
        GROUP BY at.vyapari_id
    ) sub
    WHERE p.party_id = sub.vyapari_id;


    -------------------------------------------------------
    -- 2️⃣ Collect auction IDs eligible for deletion
    -------------------------------------------------------
    SELECT ARRAY(
        SELECT a.auction_id
        FROM auction a
        WHERE a.auction_id IN (
            SELECT at.auction_id
            FROM auction_transaction at
            WHERE at.auction_transaction_id = ANY(auction_transaction_ids)
        )
        AND NOT EXISTS (
            SELECT 1
            FROM auction_transaction at2
            WHERE at2.auction_id = a.auction_id
            AND at2.auction_transaction_id <> ALL(auction_transaction_ids)
        )
    )
    INTO deleted_auction_ids;


    -------------------------------------------------------
    -- 3️⃣ Delete auction transactions
    -------------------------------------------------------
    DELETE FROM auction_transaction
    WHERE auction_transaction_id = ANY(auction_transaction_ids);


    -------------------------------------------------------
    -- 4️⃣ Delete auction headers if safe
    -------------------------------------------------------
    IF deleted_auction_ids IS NOT NULL
       AND array_length(deleted_auction_ids,1) > 0 THEN

        DELETE FROM auction
        WHERE auction_id = ANY(deleted_auction_ids);

    END IF;


    -------------------------------------------------------
    -- 5️⃣ Recreate auction using existing RPC
    -------------------------------------------------------
    in_device_id := (new_payload->0->>'deviceId')::INTEGER;

    PERFORM create_auction_bulk_with_crate(new_payload, in_device_id);


    RETURN TRUE;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'edit_auction_transactions failed: %', SQLERRM;
END;$function$
;

drop function if exists public.auction_create_v2(jsonb, integer);
drop function if exists public.auction_v2_items(jsonb);
drop function if exists public.auction_v2_auctions(jsonb, integer);
drop function if exists public.auction_txn_amount(numeric, numeric, numeric, numeric);
commit;
notify pgrst, 'reload schema';
