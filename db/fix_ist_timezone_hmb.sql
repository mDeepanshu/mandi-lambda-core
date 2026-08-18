-- IST timezone fix, part 1 of 2: RPC bodies. **hmb variant.**
--
-- The Supabase DB session runs in UTC; the mandi operates in IST (UTC+5:30).
-- Every NOW()/CURRENT_DATE/CURRENT_TIMESTAMP feeding a naive timestamp or a
-- date comparison therefore resolves to UTC wall-clock. Between 18:30 and
-- 24:00 UTC (00:00-05:30 IST) the server's "today" is a day behind the
-- mandi's, so:
--   * create_auction_bulk{,_with_crate} stamped auction_transaction.auction_date
--     with yesterday's date -- the bug that made GET /auction/generate-ledger
--     and GET /auction/list-auction-transaction disagree (they key off
--     at.auction_date and a.auction_date respectively).
--   * get_pending_vasuli's showToday branch matched the wrong day.
--   * get_unvalidated_start_date's fallback returned yesterday.
--   * the two *_update_timestamp triggers wrote UTC audit stamps.
--
-- Part 2 (db/fix_ist_timezone_defaults.sql) covers the column defaults and is
-- stage-agnostic -- run it on every stage.
--
-- GENERATED from the hmb database's own definitions, so hmb's owed_amount
-- formula (rate*quantity + chungi*bag) is preserved byte-for-byte. dev and his
-- share a different formula -- see db/fix_ist_timezone.sql. NEVER cross-apply.
--
-- Regenerate with: bash <scratchpad>/gen.sh "$DBURL" out.sql <function names>

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
      (now() AT TIME ZONE 'Asia/Kolkata'),
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
  )

  -- Final statement
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
      (now() AT TIME ZONE 'Asia/Kolkata'),
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

  crate_upsert AS (
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
      SUM(crate_count)::smallint AS crate_count,
      auction_id::text           AS parent_id,
      auction_date,
      'ISSUE'
    FROM buy_items
    WHERE crate_count > 0
    -- grouped by auction_id too: a vyapari buying the same crate type from two
    -- kisans keeps one row per kisan. Still pre-aggregated, because one vyapari
    -- can appear in several buyItems of the SAME auction and ON CONFLICT cannot
    -- update the same row twice in one statement.
    GROUP BY vyapari_id, crate_id, auction_date, auction_id
    ON CONFLICT (vyapari_id, crate_id, date, txn_type, parent_id)
    DO UPDATE
      SET crate_count = crate_transaction.crate_count + EXCLUDED.crate_count
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

CREATE OR REPLACE FUNCTION public.get_pending_vasuli(showtoday boolean)
 RETURNS TABLE(id character varying, amount numeric, date timestamp without time zone, vyapari_id character varying, remark character varying, was_null boolean, "vyapariId" character varying, "lastNotifiedAmount" numeric, "vyapariName" character varying, "idNo" character varying, "ledgerOrder" integer, "owedAmount" numeric, contact character varying)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    v.id,
    v.amount,
    v.date,
    v.vyapari_id,
    v.remark,
    v.was_null,

    p.party_id              AS "vyapariId",
    p.last_notified_amount  AS "lastNotifiedAmount",
    p.name                  AS "vyapariName",
    p.id_no                 AS "idNo",
    p.ledger_order          AS "ledgerOrder",
    p.owed_amount           AS "owedAmount",
    p.contact
  FROM vasuli v
  JOIN party p
    ON v.vyapari_id = p.party_id
  WHERE
    (
      v.amount IS NULL
      OR (showtoday = TRUE AND v.was_null = TRUE)
    )
    AND
    (
      (showtoday = TRUE  AND v.date::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)
      OR
      (showtoday = FALSE AND v.date::date < (now() AT TIME ZONE 'Asia/Kolkata')::date)
    )
  ORDER BY v.date ASC;
$function$

;

CREATE OR REPLACE FUNCTION public.get_unvalidated_start_date(p_vyapari_id text)
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    COALESCE(
      MIN(auction_date::date) - INTERVAL '1 day',
      (now() AT TIME ZONE 'Asia/Kolkata')::date
    )
  FROM auction_transaction
  WHERE validated = 'N'
    AND vyapari_id = p_vyapari_id
    AND auction_date >
      COALESCE(
        (
          SELECT MAX(auction_date)
          FROM auction_transaction
          WHERE vyapari_id = p_vyapari_id
            AND validated = 'Y'
        ),
        '1900-01-01'
      );
$function$

;

CREATE OR REPLACE FUNCTION public.device_details_update_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updation_time = (now() AT TIME ZONE 'Asia/Kolkata');
  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.vyapari_bill_update_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = (now() AT TIME ZONE 'Asia/Kolkata');
  RETURN NEW;
END;
$function$

;

