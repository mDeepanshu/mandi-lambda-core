-- Auction read paths brought to exact parity with the old Spring server
-- (mandi-server, branch app-runner-prod), so the frontends can be pointed at
-- the lambda without any visible change. dev/his formula — hmb has its own
-- copy, db/auction_legacy_parity_hmb.sql, that differs ONLY in the
-- (rate + chungi) * quantity lines.
--
--   psql -v ON_ERROR_STOP=1 -1 -f db/auction_legacy_parity.sql       # dev, his
--   psql -v ON_ERROR_STOP=1 -1 -f db/auction_legacy_parity_hmb.sql   # hmb
--
-- 1. generate_auction_ledger (GET /auction/generate-ledger, the vasuli sheet)
--    * date filters are plain timestamp ranges instead of `auction_date::date`
--      casts, so the (vyapari_id, auction_date) indexes are usable. Same rows:
--      x::date >= d  <=>  x >= d,   x::date > d  <=>  x >= d + 1. On his the
--      cast version took 5.3s for one day and timed the lambda out (6s).
--    * opening / closing / each dayBill amount truncated toward zero, as the
--      old server's Integer projections did (LedgerEntryProjection) — the sheet
--      shows whole rupees. The zero-row filter still runs on the exact values.
--    * rows ordered by party name in code-point order, as the old server's
--      Comparator.comparing(getPartyName) did; previously unordered.
--    Kept on purpose (old server was wrong): is_old = 'Y' rows are excluded
--    from the opening/closing rollback — see tests/api/06.
--
-- 2. get_auction_transactions_report3 (GET /auction/list-auction-transaction)
--    * auctionTransactions ordered like the old query: kisan name, item name
--      (only when no device filter), then header date, then row date. MySQL's
--      utf8mb4_0900_ai_ci ordering is case-insensitive, hence lower().
--    * kisanIdNo / vyapariIdNo are numbers and deviceId a string, as before
--      (they had been cast the other way round).
--    * bagWiseQuantity '' and bagWiseQuantityArray [] instead of null for rows
--      without per-bag weights — the old server always stored a string.
--
-- 3. mark_bulk_transaction_validated — PATCH ...?bulk=true (the "send all
--    ledgers" button), which the lambda rejected for want of a vyapariId.
--    Old server: validate the range for every party with auto_ledger = 'Y'.

create or replace function public.generate_auction_ledger(start_time date, end_time date)
 returns table(partyid text, partyname text, openingbalance numeric, closingbalance numeric, daybill bigint[], vyapariidno integer)
 language sql
 stable
as $function$
SELECT
    partyId,
    partyName,
    trunc(openingBalance),
    trunc(closingBalance),
    dayBill,
    vyapariIdNo
FROM (
    SELECT
        p.party_id AS partyId,
        p.name AS partyName,

        (
            COALESCE(p.owed_amount, 0)
            - COALESCE(
                (
                    SELECT SUM((rate + chungi) * quantity)
                    FROM auction_transaction
                    WHERE vyapari_id = p.party_id
                      AND auction_date >= start_time
                      AND (is_old = 'N' OR is_old IS NULL)
                ), 0
            )
            + COALESCE(
                (
                    SELECT SUM(amount)
                    FROM vasuli
                    WHERE vyapari_id = p.party_id
                      AND date >= start_time
                ), 0
            )
        ) AS openingBalance,

        (
            COALESCE(p.owed_amount, 0)
            - COALESCE(
                (
                    SELECT SUM((rate + chungi) * quantity)
                    FROM auction_transaction
                    WHERE vyapari_id = p.party_id
                      AND auction_date >= end_time + 1
                      AND (is_old = 'N' OR is_old IS NULL)
                ), 0
            )
            + COALESCE(
                (
                    SELECT SUM(amount)
                    FROM vasuli
                    WHERE vyapari_id = p.party_id
                      AND date >= end_time + 1
                ), 0
            )
        ) AS closingBalance,

        COALESCE(
            array_agg(
                trunc((at.rate + at.chungi) * at.quantity)::bigint
                ORDER BY at.auction_date
            ) FILTER (WHERE at.auction_transaction_id IS NOT NULL),
            '{}'::bigint[]
        ) AS dayBill,

        p.id_no AS vyapariIdNo

    FROM party p
    LEFT JOIN auction_transaction at
        ON at.vyapari_id = p.party_id
       AND at.auction_date >= start_time
       AND at.auction_date < end_time + 1
       AND (at.is_old = 'N' OR at.is_old IS NULL)
    WHERE p.party_type = 1
    GROUP BY p.party_id, p.name, p.owed_amount, p.id_no
) t
WHERE NOT (
    openingBalance = 0
    AND closingBalance = 0
    AND cardinality(dayBill) = 0
)
ORDER BY partyName COLLATE "C" NULLS LAST, partyId;
$function$;

create or replace function public.get_auction_transactions_report3(start_date timestamp without time zone, end_date timestamp without time zone, device_id_param integer DEFAULT NULL::integer)
 returns json
 language plpgsql
as $function$
DECLARE
    result JSON;
BEGIN

WITH base_data AS (
    SELECT
        at.vyapari_id                         AS "vyapariId",
        a.device_id::VARCHAR                  AS "deviceId",
        at.auction_id                         AS "auctionId",
        at.auction_transaction_id             AS "auctionTransactionId",
        at.auction_date                       AS "auctionDate",
        a.auction_date                        AS "auctionSubmitDate",
        at.bag                                AS "bag",
        at.quantity                           AS "quantity",
        at.rate                               AS "rate",
        (at.rate + at.chungi) * at.quantity   AS "amount",

        vp.id_no                              AS "vyapariIdNo",
        vp.name                               AS "vyapariName",
        kp.id_no                              AS "kisanIdNo",
        kp.name                               AS "kisanName",

        i.name                                AS "itemName",
        at.parent_id                          AS "parentId",
        kp.party_id                           AS "kisanId",
        i.item_id                             AS "itemId",
        at.chungi                             AS "chungi",
        COALESCE(at.bag_wise_quantity, '')    AS "bagWiseQuantity",
        string_to_array(COALESCE(at.bag_wise_quantity, ''), ',', '')::NUMERIC[]
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
    (SELECT json_agg(b ORDER BY
        CASE WHEN device_id_param IS NULL THEN lower(b."kisanName") END COLLATE "C",
        CASE WHEN device_id_param IS NULL THEN lower(b."itemName") END COLLATE "C",
        b."auctionSubmitDate",
        b."auctionDate",
        b."txnNo")
     FROM base_data b)
)
INTO result;

RETURN result;

END;
$function$;

create or replace function public.mark_bulk_transaction_validated(from_date date, to_date date)
 returns integer
 language plpgsql
as $function$
declare
  v_count integer;
begin
  if from_date is null or to_date is null then
    raise exception 'from_date and to_date are required';
  end if;

  update auction_transaction at
  set validated = 'Y'
  where at.auction_date >= from_date
    and at.auction_date < to_date + 1
    and at.validated = 'N'
    and at.vyapari_id in (select party_id from party where auto_ledger = 'Y');

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
