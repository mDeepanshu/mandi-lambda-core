-- Fix: closingBalance was computed as of the START of end_time, not the end of it.
-- See fix_ledger_closing_balance.sql for the full explanation.
-- This is the hmb variant -- hmb's amount formula is rate*quantity + chungi*bag,
-- NOT (rate+chungi)*quantity. Do not cross-apply between stages.

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
                      AND auction_date::date >= start_time
                      AND (is_old = 'N' OR is_old IS NULL)
                ), 0
            )
            + COALESCE(
                (
                    SELECT SUM(amount)
                    FROM vasuli
                    WHERE vyapari_id = p.party_id
                      AND date::date >= start_time
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
                      AND auction_date::date > end_time
                      AND (is_old = 'N' OR is_old IS NULL)
                ), 0
            )
            + COALESCE(
                (
                    SELECT SUM(amount)
                    FROM vasuli
                    WHERE vyapari_id = p.party_id
                      AND date::date > end_time
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
$function$;
