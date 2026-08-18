-- Chungi/owed formula pack for HIS client (also applied to dev).
-- Business rule: amount = (rate + chungi) * quantity
-- Fixes the create/delete writers, which wrongly used rate * (quantity + chungi).
-- Edit RPCs and all ledgers/reports already used the correct formula.

CREATE OR REPLACE FUNCTION public.create_auction_bulk(p_payload jsonb, p_device_id integer)
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
      ad.ord
    FROM (
      SELECT auction_id,
             ROW_NUMBER() OVER () AS rn
      FROM inserted_auction
    ) ia
    JOIN (
      SELECT auction_obj,
             ord,
             ROW_NUMBER() OVER (ORDER BY ord) AS rn
      FROM auction_data
    ) ad
    ON ia.rn = ad.rn
  ),

  buy_items AS (
    SELECT
      awo.auction_id,
      (bi->>'auction_transaction_id')::text AS auction_transaction_id,
      (bi->>'vyapariId') AS vyapari_id,
      (bi->>'quantity')::numeric AS quantity,
      (bi->>'rate')::numeric AS rate,
      COALESCE((bi->>'chungi')::int, 0) AS chungi,
      (bi->>'bag')::int AS bag,
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
      NOW(),
      vyapari_id,
      quantity,
      bag,
      rate,
      chungi,
      bag_wise_quantity,
      'N',
      'N'
    FROM buy_items
    RETURNING vyapari_id, rate, quantity, chungi
  )

  -- Final statement
  UPDATE party p
  SET owed_amount = COALESCE(p.owed_amount, 0) + t.total_amount
  FROM (
    SELECT
      vyapari_id,
      SUM((rate + COALESCE(chungi, 0)) * quantity) AS total_amount
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

CREATE OR REPLACE FUNCTION public.create_auction_bulk_with_crate(p_payload jsonb, p_device_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$BEGIN

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
      NOW(),
      vyapari_id,
      quantity,
      bag,
      rate,
      chungi,
      bag_wise_quantity,
      'N',
      'N'
    FROM buy_items
    RETURNING vyapari_id, rate, quantity, chungi
  ),

  -- ❌ No aggregation, direct UPSERT
  crate_upsert AS (
    INSERT INTO crate_transaction (
      vyapari_id,
      crate_id,
      crate_count,
      parent_id,
      date
    )
    SELECT
      vyapari_id,
      crate_id,
      SUM(crate_count)        AS crate_count,
      MIN(auction_id::text)   AS parent_id,
      auction_date
    FROM buy_items
    WHERE crate_count > 0
    GROUP BY vyapari_id, crate_id, auction_date
    ON CONFLICT (vyapari_id, crate_id, date)
    DO UPDATE
      SET crate_count = crate_transaction.crate_count + EXCLUDED.crate_count
  )

  -- Final update
  UPDATE party p
  SET owed_amount = COALESCE(p.owed_amount, 0) + t.total_amount
  FROM (
    SELECT
      vyapari_id,
      SUM((rate + COALESCE(chungi, 0)) * quantity) AS total_amount
    FROM inserted_transactions
    GROUP BY vyapari_id
  ) t
  WHERE p.party_id = t.vyapari_id;

  RETURN true;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;$function$

;

CREATE OR REPLACE FUNCTION public.add_auction(payload jsonb, device_id text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$DECLARE
  auction_obj jsonb;
  buy_item jsonb;
  auction_uuid uuid;
  vyapari_amount numeric;
BEGIN
  -- Loop over each auction object
  FOR auction_obj IN
    SELECT * FROM jsonb_array_elements(payload)
  LOOP

    -- 1️⃣ Insert into auction table
    INSERT INTO auction (
      kisan_id,
      item_id,
      total_bags,
      auction_date,
      device_id
    )
    VALUES (
      auction_obj->>'kisan_id',
      auction_obj->>'item_id',
      (auction_obj->>'total_bags')::int,
      (auction_obj->>'auctionDate')::timestamp,
      COALESCE(auction_obj->>'device_id', device_id)
    )
    RETURNING auction_id INTO auction_uuid;

    -- Safety check
    IF auction_uuid IS NULL THEN
      RAISE EXCEPTION 'Failed to create auction';
    END IF;

    -- 2️⃣ Loop over buyItems
    FOR buy_item IN
      SELECT * FROM jsonb_array_elements(auction_obj->'buyItems')
    LOOP

      -- Calculate owed amount (rate × quantity)
      vyapari_amount :=
        ((buy_item->>'rate')::numeric + COALESCE((buy_item->>'chungi')::int, 0)) *
        (buy_item->>'quantity')::numeric;

      -- 3️⃣ Insert auction transaction
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
      VALUES (
        auction_uuid,
        (buy_item->>'auctionDate')::timestamp,
        buy_item->>'vyapariId',
        (buy_item->>'quantity')::numeric,
        (buy_item->>'bag')::int,
        (buy_item->>'rate')::numeric,
        COALESCE((buy_item->>'chungi')::int, 0),
        (
          SELECT string_agg(value, ',')
          FROM jsonb_array_elements_text(buy_item->'bagWiseQuantity')
        ),
        'N',
        'N'
      );

      -- 4️⃣ Update vyapari owed amount
      UPDATE party
      SET owed_amount = COALESCE(owed_amount, 0) + vyapari_amount
      WHERE party_id = buy_item->>'vyapariId';

    END LOOP;

  END LOOP;

  RETURN true;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;$function$

;
-- Deletes auction transactions and reverses the vyaparis' owed_amount.
-- Called by DELETE /auction/delete-auction-transaction via PostgREST, which
-- matches the camelCase argument name exactly.
-- Reversal formula (HIS rule): (rate + chungi) * quantity.
-- Auction headers left with no transactions are removed too (same behavior as
-- edit_auction_by_recreate2). Crate movements (crate_transaction) are NOT
-- reversed, consistent with the existing edit RPCs.
create or replace function delete_auction_transactions("auctionTransactionIds" uuid[])
returns boolean
language plpgsql
as $$
declare
  v_ids uuid[] := "auctionTransactionIds";
  v_empty_auction_ids uuid[];
begin
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'auctionTransactionIds cannot be empty';
  end if;

  -- 1. reverse owed amount
  update party p
  set owed_amount = coalesce(p.owed_amount, 0) - sub.total_amount
  from (
    select at.vyapari_id,
           coalesce(sum((at.rate + coalesce(at.chungi, 0)) * at.quantity), 0) as total_amount
    from auction_transaction at
    where at.auction_transaction_id = any(v_ids)
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
      where at.auction_transaction_id = any(v_ids)
    )
    and not exists (
      select 1
      from auction_transaction at2
      where at2.auction_id = a.auction_id
        and at2.auction_transaction_id <> all(v_ids)
    )
  ) into v_empty_auction_ids;

  -- 3. delete the transactions
  delete from auction_transaction
  where auction_transaction_id = any(v_ids);

  -- 4. delete now-empty auction headers
  if v_empty_auction_ids is not null and array_length(v_empty_auction_ids, 1) > 0 then
    delete from auction
    where auction_id = any(v_empty_auction_ids);
  end if;

  return true;
end;
$$;
