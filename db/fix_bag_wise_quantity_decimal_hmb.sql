-- Fix: a decimal bag weight (e.g. 18.5) in auction_transaction.bag_wise_quantity
-- 500ed every report that touched that row. The write path accepts decimals
-- (bagWiseQuantity is z.coerce.number()), but the readers built the array with
-- `string_to_array(...)::INTEGER[]`, which throws 22P02
-- "invalid input syntax for type integer". Cast to NUMERIC[] instead, and map
-- empty elements (trailing commas) to NULL rather than failing on them.
--
-- Affects GET /auction/list-auction-transaction (get_auction_transactions_report3)
-- and the vyapari bill (generate_bill_by_vyapari_id_and_date). Both return json,
-- so the column type change is transparent; whole bags still serialize as 20, not 20.0.
-- get_auction_transactions_report2 has the same cast but is uncalled legacy with
-- `integer[]` in its RETURNS TABLE, so it is left alone.
--
-- Stage: hmb  (rate * quantity + chungi * bag formula preserved)

CREATE OR REPLACE FUNCTION public.get_auction_transactions_report3(start_date timestamp without time zone, end_date timestamp without time zone, device_id_param integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
    result JSON;
BEGIN

WITH base_data AS (
    SELECT
        at.vyapari_id                         AS "vyapariId",
        a.device_id                           AS "deviceId",
        at.auction_id                         AS "auctionId",
        at.auction_transaction_id             AS "auctionTransactionId",
        at.auction_date                       AS "auctionDate",
        a.auction_date                        AS "auctionSubmitDate",
        at.bag                                AS "bag",
        at.quantity                           AS "quantity",
        at.rate                               AS "rate",
        at.rate * at.quantity + COALESCE(at.chungi, 0) * COALESCE(at.bag, 0) AS "amount",

        vp.id_no::VARCHAR                     AS "vyapariIdNo",
        vp.name                               AS "vyapariName",
        kp.id_no::VARCHAR                     AS "kisanIdNo",
        kp.name                               AS "kisanName",

        i.name                                AS "itemName",
        at.parent_id                          AS "parentId",
        kp.party_id                           AS "kisanId",
        i.item_id                             AS "itemId",
        at.chungi                             AS "chungi",
        at.bag_wise_quantity                  AS "bagWiseQuantity",
        string_to_array(at.bag_wise_quantity, ',', '')::NUMERIC[]
                                              AS "bagWiseQuantityArray",
        at.txn_no                             AS "txnNo"

    FROM auction_transaction at
    JOIN auction a ON a.auction_id = at.auction_id
    JOIN party vp ON vp.party_id = at.vyapari_id
    JOIN party kp ON kp.party_id = a.kisan_id
    JOIN items i ON i.item_id = a.item_id

    WHERE
        a.auction_date >= start_date
        AND a.auction_date < (end_date + INTERVAL '1 day')
        AND at.is_old = 'N'
        AND (
            device_id_param IS NULL
            OR a.device_id = device_id_param
        )
),

item_totals AS (
    SELECT
        "itemName" AS name,
        SUM("bag") AS bags,
        SUM("quantity") AS quantity,
        SUM("amount") AS amount
    FROM base_data
    GROUP BY "itemName"
)

SELECT json_build_object(
    'itemTotals',
    (SELECT json_agg(item_totals) FROM item_totals),
    'auctionTransactions',
    (SELECT json_agg(base_data) FROM base_data)
)
INTO result;

RETURN result;

END;
$function$
;


CREATE OR REPLACE FUNCTION public.generate_bill_by_vyapari_id_and_date(vyapari_id_param text, start_date date, end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$DECLARE
  bill_list JSONB;
  bill_total NUMERIC;
  current_outstanding NUMERIC;
BEGIN
  /* 1️⃣ Bill list */
  SELECT
    COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb),
    COALESCE(SUM(t."itemTotal"), 0)
  INTO bill_list, bill_total
  FROM (
    SELECT
      at.auction_transaction_id::TEXT            AS "auctionTransactionId", -- ✅ added
      i.name::TEXT                               AS "itemName",
      at.bag                                    AS "bag",
      at.chungi::NUMERIC                        AS "chungi",
      at.rate::NUMERIC                          AS "rate",
      at.quantity::NUMERIC                      AS "quantity",
      at.bag_wise_quantity::TEXT               AS "bagWiseQuantity",
      string_to_array(at.bag_wise_quantity, ',', '')::NUMERIC[]
                                                 AS "bagWiseQuantityArray",
      (at.rate * at.quantity)::NUMERIC          AS "itemTotal",
      a.auction_date                            AS "auctionDate",
      p.name::TEXT                              AS "partyName",
      dd.name::TEXT                             AS "deviceName"
    FROM auction_transaction at
    JOIN auction a
      ON a.auction_id = at.auction_id
    JOIN items i
      ON a.item_id = i.item_id
    JOIN party p
      ON a.kisan_id = p.party_id
    JOIN device_details dd
      ON dd.id = a.device_id
    WHERE at.vyapari_id = vyapari_id_param
      AND a.auction_date >= start_date
      AND a.auction_date < end_date
      AND at.is_old = 'N'
    ORDER BY a.auction_date
  ) t;

  /* 2️⃣ Current outstanding from party */
  SELECT COALESCE(owed_amount, 0)
  INTO current_outstanding
  FROM party
  WHERE party_id = vyapari_id_param;

  /* 3️⃣ Final JSON response */
  RETURN jsonb_build_object(
    'currentOutstanding', current_outstanding,
    'billList', bill_list,
    'billTotal', bill_total
  );
END;$function$
;


