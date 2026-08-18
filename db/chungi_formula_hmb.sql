-- Chungi/owed formula pack for HMB client.
-- Business rule: amount = rate * quantity + chungi * bag
-- Rewrites ALL owed-amount writers and every ledger/report reader.

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
        (buy_item->>'rate')::numeric * (buy_item->>'quantity')::numeric +
        COALESCE((buy_item->>'chungi')::int, 0) * COALESCE((buy_item->>'bag')::int, 0);

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
    RETURNING vyapari_id, rate, quantity, chungi, bag
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
      SUM(rate * quantity + COALESCE(chungi, 0) * COALESCE(bag, 0)) AS total_amount
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

CREATE OR REPLACE FUNCTION public.edit_auction_by_recreate(auction_transaction_ids text[], new_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$DECLARE
    deleted_auction_ids TEXT[];
    in_device_id TEXT;
BEGIN
    -- 1️⃣ Reverse owed amount
    UPDATE party p
    SET owed_amount = p.owed_amount - (
        SELECT COALESCE(SUM(at.rate * at.quantity + COALESCE(at.chungi, 0) * COALESCE(at.bag, 0)), 0)
        FROM auction_transaction at
        WHERE at.vyapari_id = p.party_id
          AND at.auction_transaction_id = ANY(auction_transaction_ids)
    )
    WHERE p.party_id IN (
        SELECT at2.vyapari_id
        FROM auction_transaction at2
        WHERE at2.auction_transaction_id = ANY(auction_transaction_ids)
    );

    -- 2️⃣ Collect deletable auction IDs
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

    -- 3️⃣ Delete auction transactions
    DELETE FROM auction_transaction
    WHERE auction_transaction_id = ANY(auction_transaction_ids);

    -- 4️⃣ Delete auction headers if safe
    IF deleted_auction_ids IS NOT NULL
       AND array_length(deleted_auction_ids, 1) > 0 THEN
        DELETE FROM auction
        WHERE auction_id = ANY(deleted_auction_ids);
    END IF;

    -- 5️⃣ Call existing add_auction RPC (FIXED)
    in_device_id := new_payload->0->>'device_id';
    PERFORM edit_auction_by_recreate(new_payload, in_device_id);

    RETURN TRUE;
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

CREATE OR REPLACE FUNCTION public.find_ledger_transactions(p_vyapari_id text, start_date date, end_date date, filter_out_non_validated boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$DECLARE
  v_opening_amount NUMERIC;
  v_closing_amount NUMERIC;
  v_closing_amount_date DATE;
  v_ledger JSONB;
  v_party RECORD;
BEGIN

  v_opening_amount :=
    find_vyapari_closing_amount_on_date(
      p_vyapari_id,
      start_date - 1
    );

  v_closing_amount :=
    find_vyapari_closing_amount_on_date(
      p_vyapari_id,
      end_date
    );

  v_closing_amount_date :=
    get_unvalidated_start_date(p_vyapari_id);


  SELECT
    p.party_id,
    p.id_no,
    p.name,
    p.ledger_order
  INTO v_party
  FROM party p
  WHERE p.party_id = p_vyapari_id;


  SELECT jsonb_agg(
           row_to_json(l)
           ORDER BY l."date"::date
         )
  INTO v_ledger
  FROM (
      SELECT
        to_char(at.auction_date::date, 'YYYY-MM-DD') AS "date",
        'V'                                           AS tv,
        0::NUMERIC                                    AS cr,
        (at.rate * at.quantity + COALESCE(at.chungi, 0) * COALESCE(at.bag, 0))::NUMERIC AS dr,
        i.name::TEXT                                  AS "itemName",
        NULL::TEXT                                    AS remark
      FROM auction_transaction at
      JOIN auction a
        ON a.auction_id = at.auction_id
      LEFT JOIN items i
        ON i.item_id = a.item_id
      WHERE at.vyapari_id = p_vyapari_id
        AND at.auction_date::date BETWEEN start_date AND end_date
        AND at.is_old = 'N'
        AND (
          NOT filter_out_non_validated
          OR at.validated = 'Y'
        )

      UNION ALL

      SELECT
        to_char(v.date::date, 'YYYY-MM-DD') AS "date",
        'T'                                  AS tv,
        v.amount::NUMERIC                    AS cr,
        0::NUMERIC                           AS dr,
        ''::TEXT                             AS "itemName",
        v.remark::TEXT                       AS remark
      FROM vasuli v
      WHERE v.amount IS NOT NULL
        AND v.vyapari_id = p_vyapari_id
        AND v.date::date BETWEEN start_date AND end_date
  ) l;

  RETURN jsonb_build_object(
    'vyapariId',           v_party.party_id,
    'vyapariIdNo',         v_party.id_no,
    'vyapariName',         v_party.name,
    'ledgerOrder',         v_party.ledger_order,
    'openingAmount',       v_opening_amount,
    'closingAmount',       v_closing_amount,
    'closingAmountOfDate', v_closing_amount_date,
    'transactions',        COALESCE(v_ledger, '[]'::jsonb)
  );
END;$function$

;

CREATE OR REPLACE FUNCTION public.find_ledger_transactions_list(vyapari_ids text[], start_date date, end_date date)
 RETURNS TABLE(txn_date timestamp without time zone, tv text, cr numeric, dr numeric, item_name text, remark text, vyapari_id text)
 LANGUAGE sql
AS $function$
  select
    ledger.txn_date,
    ledger.tv,
    ledger.cr,
    ledger.dr,
    ledger.item_name,
    ledger.remark,
    ledger.vyapari_id
  from (
    -- Auction (Debit)
    select
      at.auction_date          as txn_date,
      'V'                      as tv,
      0::numeric               as cr,
      coalesce(at.rate * at.quantity + COALESCE(at.chungi, 0) * COALESCE(at.bag, 0), 0) as dr,
      i.name                   as item_name,
      null::text               as remark,
      at.vyapari_id
    from auction_transaction at
    join auction a on a.auction_id = at.auction_id
    left join items i on i.item_id = a.item_id
    where
      at.vyapari_id = any(vyapari_ids)
      and at.auction_date::date between start_date and end_date
      and at.is_old = 'N'

    union all

    -- Vasuli (Credit)
    select
      v.date                   as txn_date,
      'T'                      as tv,
      v.amount                 as cr,
      0::numeric               as dr,
      ''::text                 as item_name,
      v.remark,
      v.vyapari_id
    from vasuli v
    where
      v.vyapari_id = any(vyapari_ids)
      and v.date::date between start_date and end_date
  ) ledger
  order by ledger.txn_date asc;
$function$

;

CREATE OR REPLACE FUNCTION public.find_vyapari_closing_amount_on_date(p_vyapari_id text, p_end_date date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
    select
        coalesce(
            (select owed_amount
             from party
             where party_id = p_vyapari_id),
            0
        )
      + coalesce(
            (select sum(v.amount)
             from vasuli v
             where v.vyapari_id = p_vyapari_id
               and v.date::date > p_end_date),
            0
        )
      - coalesce(
            (select sum(at.rate * at.quantity + COALESCE(at.chungi, 0) * COALESCE(at.bag, 0))
             from auction_transaction at
             where at.vyapari_id = p_vyapari_id
               and at.is_old = 'N'
               and at.auction_date::date > p_end_date),
            0
        );
$function$

;

CREATE OR REPLACE FUNCTION public.find_vyapari_closing_amount_on_date_list(vyapari_ids text[], end_date timestamp without time zone)
 RETURNS TABLE(partyid text, closingamount numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    p.party_id AS partyId,
    COALESCE(p.owed_amount, 0)
    + COALESCE((
        SELECT SUM(v.amount)
        FROM vasuli v
        WHERE v.vyapari_id = p.party_id
          AND v.date > end_date
      ), 0)
    - COALESCE((
        SELECT SUM(at.rate * at.quantity + COALESCE(at.chungi, 0) * COALESCE(at.bag, 0))
        FROM auction_transaction at
        WHERE at.vyapari_id = p.party_id
          AND at.auction_date::date > end_date
      ), 0) AS closingAmount
  FROM party p
  WHERE p.party_id = ANY(vyapari_ids);
$function$

;

CREATE OR REPLACE FUNCTION public.generate_auction_ledger(start_time date, end_time date)
 RETURNS TABLE(partyid text, partyname text, openingbalance numeric, closingbalance numeric, daybill bigint[], vyapariidno integer)
 LANGUAGE sql
AS $function$
SELECT *
FROM (
    SELECT
        p.party_id AS partyId,
        p.name AS partyName,

        (
            COALESCE(p.owed_amount, 0)
            - COALESCE(
                (
                    SELECT SUM(rate * quantity + COALESCE(chungi, 0) * COALESCE(bag, 0))
                    FROM auction_transaction
                    WHERE vyapari_id = p.party_id
                      AND auction_date > start_time
                ), 0
            )
            + COALESCE(
                (
                    SELECT SUM(amount)
                    FROM vasuli
                    WHERE vyapari_id = p.party_id
                      AND date > start_time
                ), 0
            )
        ) AS openingBalance,

        (
            COALESCE(p.owed_amount, 0)
            - COALESCE(
                (
                    SELECT SUM(rate * quantity + COALESCE(chungi, 0) * COALESCE(bag, 0))
                    FROM auction_transaction
                    WHERE vyapari_id = p.party_id
                      AND auction_date > end_time
                ), 0
            )
            + COALESCE(
                (
                    SELECT SUM(amount)
                    FROM vasuli
                    WHERE vyapari_id = p.party_id
                      AND date > end_time
                ), 0
            )
        ) AS closingBalance,

        COALESCE(
            array_agg(
                (at.rate * at.quantity + COALESCE(at.chungi, 0) * COALESCE(at.bag, 0))::bigint
                ORDER BY at.auction_date
            ) FILTER (WHERE at.auction_transaction_id IS NOT NULL),
            '{}'::bigint[]
        ) AS dayBill,

        p.id_no AS vyapariIdNo

    FROM party p
    LEFT JOIN auction_transaction at
        ON at.vyapari_id = p.party_id
       AND at.auction_date::date BETWEEN start_time AND end_time
       AND (at.is_old = 'N' OR at.is_old IS NULL)
    WHERE p.party_type = 1
    GROUP BY p.party_id, p.name, p.owed_amount, p.id_no
) t
WHERE NOT (
    openingBalance = 0
    AND closingBalance = 0
    AND cardinality(dayBill) = 0
);
$function$

;

CREATE OR REPLACE FUNCTION public.get_auction_transactions_report2(start_date timestamp without time zone, end_date timestamp without time zone, device_id_param character varying DEFAULT NULL::character varying)
 RETURNS TABLE("vyapariId" character varying, "deviceId" character varying, "auctionId" character varying, "auctionTransactionId" character varying, "auctionDate" timestamp without time zone, "auctionSubmitDate" timestamp without time zone, bag integer, quantity numeric, rate numeric, amount numeric, "vyapariIdNo" character varying, "vyapariName" character varying, "kisanIdNo" character varying, "kisanName" character varying, "itemName" character varying, "parentId" character varying, "kisanId" character varying, "itemId" character varying, chungi integer, "bagWiseQuantity" character varying, "bagWiseQuantityArray" integer[], "txnNo" integer)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
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
        string_to_array(at.bag_wise_quantity, ',')::INTEGER[]
                                              AS "bagWiseQuantityArray",
        at.txn_no                             AS "txnNo"

    FROM auction_transaction at
    JOIN auction a
        ON a.auction_id = at.auction_id
    JOIN party vp
        ON vp.party_id = at.vyapari_id
    JOIN party kp
        ON kp.party_id = a.kisan_id
    JOIN items i
        ON i.item_id = a.item_id

    WHERE
        a.auction_date >= start_date
        AND a.auction_date < (end_date + INTERVAL '1 day')
        AND at.is_old = 'N'
        AND (
            device_id_param IS NULL
            OR a.device_id = device_id_param
        )

    ORDER BY
        CASE WHEN device_id_param IS NULL THEN kp.name END,
        CASE WHEN device_id_param IS NULL THEN i.name END,
        a.auction_date,
        at.auction_date;
END;
$function$

;

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
        string_to_array(at.bag_wise_quantity, ',')::INTEGER[]
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
-- Deletes auction transactions and reverses the vyaparis' owed_amount.
-- Called by DELETE /auction/delete-auction-transaction via PostgREST, which
-- matches the camelCase argument name exactly.
-- Reversal formula (HMB rule): rate * quantity + chungi * bag.
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
           coalesce(sum(at.rate * at.quantity + coalesce(at.chungi, 0) * coalesce(at.bag, 0)), 0) as total_amount
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
