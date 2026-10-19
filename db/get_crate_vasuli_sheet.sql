-- GET /crate/vasuli-sheet?p_date=YYYY-MM-DD
--
-- Day `transactions` list ISSUE (debit) rows only; RETURN (credit) rows are
-- stored as negative crate_count and used to be netted into the day's figure.
-- opening_balance / closing_balance stay NET (issues minus returns) — they are
-- balances, so returns must still reduce them.

CREATE OR REPLACE FUNCTION public.get_crate_vasuli_sheet(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$DECLARE
  result jsonb;
BEGIN

  SELECT jsonb_agg(vyapari_data)
  INTO result
  FROM (

    SELECT
      jsonb_build_object(
        'vyapari_id', p.party_id,
        'vyapari_name', p.name,

        -- Opening balance
        'opening_balance', COALESCE(opening.opening_balance, 0),

        -- Issues of the day (per crate)
        'transactions', COALESCE(day_txn.txn_array, '[]'::jsonb),

        -- Closing balance
        'closing_balance', COALESCE(closing.closing_balance, 0)
      ) AS vyapari_data

    FROM party p

    -- 🔹 Opening balance (before date)
    LEFT JOIN (
      SELECT
        vyapari_id,
        SUM(crate_count) AS opening_balance
      FROM crate_transaction
      WHERE date < p_date
      GROUP BY vyapari_id
    ) opening
      ON opening.vyapari_id = p.party_id

    -- 🔹 Closing balance (till date)
    LEFT JOIN (
      SELECT
        vyapari_id,
        SUM(crate_count) AS closing_balance
      FROM crate_transaction
      WHERE date <= p_date
      GROUP BY vyapari_id
    ) closing
      ON closing.vyapari_id = p.party_id

    -- 🔹 Day issues (grouped by crate) — returns excluded
    LEFT JOIN (
      SELECT
        sub.vyapari_id,
        jsonb_agg(
          jsonb_build_object(
            'crate_name', sub.crate_name,
            'crate_count', sub.crate_count
          )
          ORDER BY sub.crate_name
        ) AS txn_array
      FROM (
        SELECT
          ct.vyapari_id,
          c.crate_name,
          SUM(ct.crate_count) AS crate_count
        FROM crate_transaction ct
        JOIN crate c ON c.id = ct.crate_id
        WHERE ct.date = p_date
          AND ct.txn_type = 'ISSUE'
        GROUP BY ct.vyapari_id, c.crate_name
      ) sub
      GROUP BY sub.vyapari_id
    ) day_txn
      ON day_txn.vyapari_id = p.party_id

    -- Only include relevant vyaparis
    WHERE
      opening.opening_balance IS NOT NULL
      OR closing.closing_balance IS NOT NULL
      OR day_txn.txn_array IS NOT NULL

  ) t;

  RETURN COALESCE(result, '[]'::jsonb);

END;$function$;
