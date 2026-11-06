-- Party / vasuli / vyapari-ledger / vyapari-bill / device endpoints brought to
-- the old Spring server's exact contract (mandi-server app-runner-prod for his,
-- app-runner-prod-2 for hmb), so mandi-application and mandi-auction can be
-- pointed at the lambda unchanged. Same file on every stage; the client
-- differences live in legacy_client() / legacy_txn_amount():
--
--   psql -v ON_ERROR_STOP=1 -1 -f db/legacy_client_his.sql -f db/legacy_parity_api.sql   # dev, his
--   psql -v ON_ERROR_STOP=1 -1 -f db/legacy_client_hmb.sql -f db/legacy_parity_api.sql   # hmb
--
-- Every function is NEW (legacy_*), so a lambda still calling the older
-- get_all_parties / find_ledger_transactions / ... keeps working until it is
-- redeployed.
--
-- Shapes follow what the old server's Jackson actually emitted:
--   * native-query projections typed String (PartyProjection, PendingVasuliDTO)
--     -> numbers as text with 2 decimals, timestamps as java.sql.Timestamp
--     .toString() ("2026-10-31 14:41:52.691", ".0" when whole) — legacy_ts_string
--   * LocalDateTime fields -> ISO without zone, which is what to_jsonb(timestamp)
--     gives; LocalDate -> YYYY-MM-DD
--   * vasuli.date is stored as UTC wall-clock time (the frontends post ISO "...Z"
--     and both Jackson and the ::timestamp cast drop the zone), and the old
--     MySQL ran in UTC — so "today" for vasuli is the UTC date, legacy_utc_today
--
-- Kept different on purpose (old-server bugs, see each function):
--   * ledger-list closing/opening and entries are computed exactly like the
--     single ledger; the old list query skipped the end date's vasulis and
--     counted edited (is_old='Y') rows
--   * hmb PATCH /party no longer NULLs owed_amount when the body has none
--   * POST /party with an existing partyId fails instead of overwriting it
--   * edit-vasuli of an unknown id fails instead of creating a vasuli
--   * vyapari bill rows grouped in time order, not Java HashMap order
--   * a vasuli with no amount no longer turns owed_amount NULL (insert_vasuli did)

alter table party add column if not exists chungi boolean;

create or replace function legacy_utc_today() returns date
language sql stable as $$ select (now() at time zone 'UTC')::date $$;

create or replace function legacy_ts_string(p_ts timestamp) returns text
language sql immutable as $$
  select to_char(p_ts, 'YYYY-MM-DD HH24:MI:SS') || '.' ||
         coalesce(nullif(rtrim(to_char(p_ts, 'US'), '0'), ''), '0')
$$;

create or replace function legacy_money_text(p numeric) returns text
language sql immutable as $$ select round(p, 2)::text $$;

-- owed_amount as it stood at the end of p_day: findVyapariClosingAmountOnDate
create or replace function legacy_closing_on(p_vyapari_id text, p_day date) returns numeric
language sql stable as $$
  select coalesce((select owed_amount from party where party_id = p_vyapari_id), 0)
       + coalesce((select sum(amount) from vasuli
                   where vyapari_id = p_vyapari_id and date >= p_day + 1), 0)
       - coalesce((select sum(legacy_txn_amount(rate, chungi, quantity, bag)) from auction_transaction
                   where vyapari_id = p_vyapari_id and is_old = 'N' and auction_date >= p_day + 1), 0)
$$;

-- ---------------------------------------------------------------- party

-- GET /party/listAllParties — PartyProjection, primary-key order (what MySQL
-- returned for the unordered query; utf8mb4_0900_ai_ci, hence lower()).
-- lastVasuliDate is the latest vasuli, not the stale party column. jsonb, not
-- a set: PostgREST caps set-returning RPCs at 1000 rows (his has 1255 parties).
create or replace function legacy_list_parties(p_party_type smallint default null) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'partyId', p.party_id,
             'idNo', p.id_no::text,
             'contact', p.contact,
             'name', p.name,
             'owedAmount', p.owed_amount,
             'partyType', p.party_type::text,
             'maxLoanDays', p.max_loan_days,
             'ledgerOrder', p.ledger_order,
             'lastVasuliDate', legacy_ts_string((select max(v.date) from vasuli v where v.vyapari_id = p.party_id)),
             'partyCode', p.party_code,
             'kisanType', p.kisan_type,
             'autoLedger', p.auto_ledger,
             'commission', legacy_money_text(p.commission_rate)
           ) || case when legacy_client() = 'his' then jsonb_build_object('chungi', p.chungi) else '{}'::jsonb end
           order by lower(p.party_id) collate "C", p.party_id), '[]'::jsonb)
  from party p
  where p_party_type is null or p.party_type = p_party_type
$$;

-- The Party entity as the old server serialized it (getPartyById, POST /party).
-- Its lastVasuliDate getter returned a random date; this returns the real one.
create or replace function legacy_party_entity(p_party_id text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
           'partyId', p.party_id,
           'name', p.name,
           'contact', p.contact,
           'partyType', case p.party_type when 0 then 'KISAN' when 1 then 'VYAPARI' end,
           'owedAmount', coalesce(p.owed_amount, 0),
           'idNo', p.id_no,
           'maxLoanDays', p.max_loan_days,
           'ledgerOrder', p.ledger_order,
           'partyCode', p.party_code,
           'kisanType', p.kisan_type,
           'autoLedger', p.auto_ledger,
           'commission', p.commission_rate,
           'lastVasuliDate', (select max(v.date)::date from vasuli v where v.vyapari_id = p.party_id)
         ) || case when legacy_client() = 'his' then jsonb_build_object('chungi', p.chungi) else '{}'::jsonb end
  from party p where p.party_id = p_party_id
$$;

create or replace function legacy_party_type(p text) returns smallint
language sql immutable as $$
  select case upper(p) when 'KISAN' then 0 when '0' then 0 when 'VYAPARI' then 1 when '1' then 1 end::smallint
$$;

-- POST /party — AddPartyRequestDTO.convertToParty + saveAllParties(…, true):
-- every requested ledgerOrder first shifts the parties at or after it down one,
-- then the parties are saved. owedAmount defaults to 0, partyCode to a random
-- 6 digits; hmb's DTO had no kisanType/chungi. An existing partyId is an error:
-- the old server's save() overwrote that party, owed_amount included (the
-- frontends always mint a fresh id, so only that corruption path differs).
create or replace function legacy_create_parties(p_payload jsonb) returns jsonb
language plpgsql as $$
declare
  v jsonb;
  v_order integer;
  v_ids text[] := '{}';
begin
  for v in select * from jsonb_array_elements(p_payload) loop
    v_order := nullif(v->>'ledgerOrder', '')::integer;
    if v_order is not null then
      update party set ledger_order = ledger_order + 1 where ledger_order >= v_order;
    end if;
  end loop;

  for v in select * from jsonb_array_elements(p_payload) loop
    if v->>'partyId' is null or legacy_party_type(v->>'partyType') is null then
      raise exception 'partyId and a KISAN/VYAPARI partyType are required';
    end if;
    insert into party (party_id, name, contact, party_type, owed_amount, max_loan_days, ledger_order,
                       commission_rate, kisan_type, chungi, party_code)
    values (
      v->>'partyId', v->>'name', v->>'contact', legacy_party_type(v->>'partyType'),
      coalesce(nullif(v->>'owedAmount', '')::numeric, 0),
      nullif(v->>'maxLoanDays', '')::integer,
      nullif(v->>'ledgerOrder', '')::integer,
      nullif(v->>'commission', '')::numeric,
      case when legacy_client() = 'his' then v->>'kisanType' end,
      case when legacy_client() = 'his' then nullif(v->>'chungi', '')::boolean end,
      coalesce(nullif(v->>'partyCode', ''), lpad(floor(random() * 1000000)::integer::text, 6, '0'))
    );
    v_ids := v_ids || (v->>'partyId');
  end loop;

  return (select coalesce(jsonb_agg(legacy_party_entity(id) order by ord), '[]'::jsonb)
          from unnest(v_ids) with ordinality as t(id, ord));
end;
$$;

-- PATCH /party — PartyServiceImpl.updateParty. Answers {code, body} because the
-- old server reported "not found" etc. inside an HTTP 200. Only keys present in
-- the body are written (the frontend sends the whole row; the old server's
-- mirror sends five fields and must not blank the rest). Ledger order: a party
-- getting its first order shifts everyone at or after it down; a move shifts
-- the parties in between by one.
create or replace function legacy_update_party(p jsonb) returns jsonb
language plpgsql as $$
declare
  old party%rowtype;
  v_new_order integer;
begin
  if p->>'id' is null then
    return jsonb_build_object('code', 400, 'body', 'Party ID is required');
  end if;
  select * into old from party where party_id = p->>'id';
  if not found then
    return jsonb_build_object('code', 404, 'body', 'Party not found');
  end if;

  v_new_order := case when p ? 'ledgerOrder' then nullif(p->>'ledgerOrder', '')::integer else old.ledger_order end;
  if old.ledger_order is null and v_new_order is not null then
    update party set ledger_order = ledger_order + 1 where ledger_order >= v_new_order;
  elsif old.ledger_order is not null and v_new_order is not null and v_new_order <> old.ledger_order then
    update party
    set ledger_order = ledger_order + case
          when ledger_order >= v_new_order and ledger_order < old.ledger_order then 1
          when ledger_order > old.ledger_order and ledger_order <= v_new_order then -1
          else 0 end
    where (ledger_order >= v_new_order and ledger_order < old.ledger_order)
       or (ledger_order > old.ledger_order and ledger_order <= v_new_order);
  end if;

  update party set
    name            = case when p ? 'name' then p->>'name' else name end,
    contact         = case when p ? 'contact' then p->>'contact' else contact end,
    max_loan_days   = case when p ? 'maxLoanDays' then coalesce(nullif(p->>'maxLoanDays', '')::integer, 0) else max_loan_days end,
    party_type      = case when p ? 'partyType' then legacy_party_type(p->>'partyType') else party_type end,
    kisan_type      = case when legacy_client() = 'his' and p ? 'kisanType' then p->>'kisanType' else kisan_type end,
    auto_ledger     = case when p ? 'autoLedger' then p->>'autoLedger' else auto_ledger end,
    commission_rate = case when p ? 'commission' then nullif(p->>'commission', '')::numeric else commission_rate end,
    chungi          = case when legacy_client() = 'his' and p ? 'chungi' then nullif(p->>'chungi', '')::boolean else chungi end,
    -- hmb's server copied owedAmount from the body, NULLing it whenever the
    -- frontend left it out (it always does); only an explicit value is taken
    owed_amount     = case when legacy_client() = 'hmb' and nullif(p->>'owedAmount', '') is not null
                           then (p->>'owedAmount')::numeric else owed_amount end,
    ledger_order    = v_new_order
  where party_id = old.party_id;

  return jsonb_build_object('code', 200, 'body', 'Party updated successfully');
end;
$$;

-- ---------------------------------------------------------------- vasuli

-- POST /party/vasuliTrasaction — PartyServiceImpl.addVasulies. Without
-- confirmDuplicate, the first vyapari that already has a vasuli today (UTC)
-- stops the whole request with the old warning text, as {code: 400}. was_null
-- marks a payment posted without an amount (the ledger's VASULI button), which
-- leaves owed_amount alone. Answers the generated ids in request order — the
-- old server's mirror maps them, the frontends ignore the body.
create or replace function legacy_insert_vasulies(p_payload jsonb, p_confirm_duplicate boolean) returns jsonb
language plpgsql as $$
declare
  v jsonb;
  v_name text;
  v_count bigint;
  v_id text;
  v_amount numeric;
  v_results jsonb := '[]'::jsonb;
begin
  if not p_confirm_duplicate then
    for v in select * from jsonb_array_elements(p_payload) loop
      select p.name, (select count(*) from vasuli x where x.vyapari_id = p.party_id
                       and x.date >= legacy_utc_today() and x.date < legacy_utc_today() + 1)
      into v_name, v_count
      from party p where p.party_id = v->>'vyapariId';
      if v_count > 0 then
        return jsonb_build_object('code', 400, 'body',
          coalesce(v_name, 'null') || ' already has ' || v_count || ' vasulis, are you sure you want to continue?');
      end if;
    end loop;
  end if;

  for v in select * from jsonb_array_elements(p_payload) loop
    if not exists (select 1 from party where party_id = v->>'vyapariId') then
      raise exception 'vyapari % not found', v->>'vyapariId';
    end if;
    v_id := gen_random_uuid()::text;
    v_amount := nullif(v->>'amount', '')::numeric;
    insert into vasuli (id, amount, date, vyapari_id, remark, was_null)
    values (v_id, v_amount, (v->>'date')::timestamp, v->>'vyapariId', v->>'remark', v_amount is null);
    if v_amount is not null then
      update party set owed_amount = coalesce(owed_amount, 0) - v_amount where party_id = v->>'vyapariId';
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'vyapariId', v->>'vyapariId', 'amount', v_amount));
  end loop;

  return jsonb_build_object('code', 200, 'body', v_results);
end;
$$;

create or replace function legacy_vasuli_entity(v vasuli) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', v.id, 'vyapariId', v.vyapari_id, 'date', v.date,
                            'amount', v.amount, 'remark', v.remark, 'wasNull', v.was_null)
$$;

-- PUT /vyapari/edit-vasuli — VyapariServiceImpl.editVasuli: the old amount goes
-- back onto the old vyapari, the new one comes off the new vyapari; amount and
-- remark are replaced as sent (an emptied amount makes it pending again), date
-- and was_null are kept. Keys absent from the body keep their value (the old
-- server's mirror leaves out nulls). An unknown id raises VASULI_NOT_FOUND: the
-- old server's save() created a fresh vasuli under it, which here would turn
-- every mirrored edit of a re-synced (re-keyed) row into a second payment.
create or replace function legacy_edit_vasuli(p jsonb) returns jsonb
language plpgsql as $$
declare
  old vasuli%rowtype;
  saved vasuli%rowtype;
begin
  select * into old from vasuli where id = p->>'id';
  if not found then
    raise exception 'VASULI_NOT_FOUND: %', p->>'id';
  end if;
  if old.amount is not null then
    update party set owed_amount = coalesce(owed_amount, 0) + old.amount where party_id = old.vyapari_id;
  end if;

  saved.id         := p->>'id';
  saved.amount     := case when p ? 'amount' then nullif(p->>'amount', '')::numeric else old.amount end;
  saved.vyapari_id := case when p ? 'vyapariId' then p->>'vyapariId' else old.vyapari_id end;
  saved.remark     := case when p ? 'remark' then p->>'remark' else old.remark end;
  saved.date       := coalesce(nullif(p->>'date', '')::timestamp, old.date);
  saved.was_null   := old.was_null;

  if saved.amount is not null then
    update party set owed_amount = coalesce(owed_amount, 0) - saved.amount where party_id = saved.vyapari_id;
  end if;

  update vasuli set amount = saved.amount, date = saved.date, vyapari_id = saved.vyapari_id,
    remark = saved.remark
  where id = saved.id;

  return legacy_vasuli_entity(saved);
end;
$$;

-- GET /vyapari/pending-vasuli — VasuliRepository.findByAmountIsNull
create or replace function legacy_pending_vasuli(p_show_today boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'vyapariId', p.party_id,
           'date', legacy_ts_string(v.date),
           'amount', legacy_money_text(v.amount),
           'remark', v.remark,
           'vyapariName', p.name,
           'idNo', p.id_no::text,
           'ledgerOrder', p.ledger_order::text,
           'owedAmount', legacy_money_text(p.owed_amount),
           'contact', p.contact,
           'lastNotifiedAmount', p.last_notified_amount
         ) order by v.date), '[]'::jsonb)
  from vasuli v join party p on v.vyapari_id = p.party_id
  where (v.amount is null or (p_show_today and v.was_null))
    and case when p_show_today then v.date >= legacy_utc_today() and v.date < legacy_utc_today() + 1
             else v.date < legacy_utc_today() end
$$;

-- GET /vyapari/vasuli-list — {vasuliList, totalVasuli}; the total adds each
-- amount truncated to whole rupees (getTotalVasuli: intValue()).
create or replace function legacy_vasuli_list(p_start date, p_end date) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'vasuliList', coalesce(jsonb_agg(jsonb_build_object(
                    'vyapariName', p.name, 'id', v.id, 'amount', v.amount, 'date', v.date,
                    'remark', v.remark, 'idNo', p.id_no::text, 'contact', p.contact
                  ) order by v.date), '[]'::jsonb),
    'totalVasuli', coalesce(sum(trunc(v.amount)), 0)::bigint)
  from vasuli v join party p on v.vyapari_id = p.party_id
  where v.date >= p_start and v.date < p_end + 1
$$;

-- ---------------------------------------------------------------- ledger

-- one vyapari's ledger lines (findLedgerTransactions); hmb's also carry
-- quantity, which MySQL's UNION typed DECIMAL(10,2): "0.00" on vasuli lines
create or replace function legacy_ledger_entries(p_vyapari_id text, p_start date, p_end date,
                                                 p_validated_only boolean, p_with_vyapari_id boolean)
returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('date', to_char(e.ts, 'YYYY-MM-DD'), 'tv', e.tv, 'cr', e.cr, 'dr', e.dr,
                              'itemName', e.item_name, 'remark', e.remark)
           || case when p_with_vyapari_id then jsonb_build_object('vyapariId', p_vyapari_id) else '{}'::jsonb end
           || case when legacy_client() = 'hmb' then jsonb_build_object('quantity', e.quantity) else '{}'::jsonb end
           order by e.ts, e.tv desc), '[]'::jsonb)
  from (
    select at.auction_date ts, 'V' tv, 0::numeric cr, legacy_txn_amount(at.rate, at.chungi, at.quantity, at.bag) dr,
           i.name::text item_name, null::text remark, legacy_money_text(at.quantity) quantity
    from auction_transaction at
    join auction a on a.auction_id = at.auction_id
    left join items i on i.item_id = a.item_id
    where at.vyapari_id = p_vyapari_id and at.auction_date >= p_start and at.auction_date < p_end + 1
      and at.is_old = 'N' and (not p_validated_only or at.validated = 'Y')
    union all
    select v.date, 'T', v.amount, 0, '', v.remark, '0.00'
    from vasuli v
    where v.amount is not null and v.vyapari_id = p_vyapari_id and v.date >= p_start and v.date < p_end + 1
  ) e
$$;

-- GET /vyapari/ledger — VyapariServiceImpl.generateLedger. p_vyapari_app is the
-- vyapariCode header (the Vyapari app): only validated lines, the closing
-- balance capped at the last validated day, and no opening balance. The opening
-- is the closing minus this window's lines, as before.
create or replace function legacy_vyapari_ledger(p_vyapari_id text, p_start date, p_end date, p_vyapari_app boolean)
returns jsonb
language plpgsql stable as $$
declare
  v_latest date;
  v_max_validated date;
  v_closing_date date;
  v_closing numeric;
  v_lines jsonb;
  v_net numeric;
begin
  if p_vyapari_app then
    select max(auction_date::date) into v_max_validated
    from auction_transaction where vyapari_id = p_vyapari_id and validated = 'Y';
    select coalesce(min(auction_date::date) - 1, legacy_utc_today()) into v_latest
    from auction_transaction
    where validated = 'N' and vyapari_id = p_vyapari_id and auction_date > v_max_validated::timestamp;
  end if;

  v_closing_date := case when v_latest is not null and p_end > v_latest then v_latest else p_end end;
  v_closing := legacy_closing_on(p_vyapari_id, v_closing_date);
  v_lines := legacy_ledger_entries(p_vyapari_id, p_start, p_end, p_vyapari_app, false);
  select coalesce(sum((l->>'dr')::numeric - coalesce((l->>'cr')::numeric, 0)), 0) into v_net
  from jsonb_array_elements(v_lines) l;

  return jsonb_build_object(
    'vyapariName', null, 'vyapariId', null, 'vyapariIdNo', null, 'ledgerOrder', null,
    'openingAmount', case when p_vyapari_app then null else v_closing - v_net end,
    'closingAmount', v_closing,
    'closingAmountOfDate', to_char(v_closing_date, 'YYYY-MM-DD'),
    'transactions', v_lines);
end;
$$;

-- POST /vyapari/ledger-list — one ledger per requested vyapari that has lines
-- in the window, ordered by ledgerOrder (nulls last). Computed exactly like
-- the single ledger: the old list query compared vasuli datetimes with the bare
-- end date (dropping the end day's payments from both the lines and the
-- closing) and counted edited rows in the closing.
create or replace function legacy_ledger_list(p_vyapari_ids text[], p_start date, p_end date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'vyapariName', p.name, 'vyapariId', p.party_id, 'vyapariIdNo', p.id_no, 'ledgerOrder', p.ledger_order,
           'closingAmount', c.closing,
           'openingAmount', c.closing - (select coalesce(sum((l->>'dr')::numeric - coalesce((l->>'cr')::numeric, 0)), 0)
                                         from jsonb_array_elements(e.lines) l),
           'closingAmountOfDate', null,
           'transactions', e.lines
         ) order by p.ledger_order nulls last, p.party_id), '[]'::jsonb)
  from party p
  cross join lateral (select legacy_ledger_entries(p.party_id, p_start, p_end, false, true) lines) e
  cross join lateral (select legacy_closing_on(p.party_id, p_end) closing) c
  where p.party_id = any(p_vyapari_ids) and jsonb_array_length(e.lines) > 0
$$;

-- GET /vyapari/ledger-list-all-vyapari — parties with a live transaction in the
-- window (listVyapariForAllLedger)
create or replace function legacy_ledger_list_all(p_start date, p_end date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'partyId', p.party_id, 'idNo', p.id_no::text, 'name', p.name,
           'ledgerOrder', p.ledger_order, 'owedAmount', p.owed_amount
         ) order by p.ledger_order nulls last, p.party_id), '[]'::jsonb)
  from party p
  where exists (select 1 from auction_transaction at
                where at.vyapari_id = p.party_id and at.is_old = 'N'
                  and at.auction_date >= p_start and at.auction_date < p_end + 1)
$$;

-- ---------------------------------------------------------------- vyapari bill

-- GET /vyapari/generateBill — VyapariServiceImpl.generateBill. billList holds
-- one array per transaction history (parent id), its last element the current
-- version; itemTotal / billTotal are whole rupees, HALF_UP, per client formula.
-- Groups come in time order (the old server used HashMap order).
create or replace function legacy_vyapari_bill(p_vyapari_id text, p_day date) returns jsonb
language sql stable as $$
  with rows as (
    select coalesce(at.parent_id, at.auction_transaction_id::text) grp, at.auction_date ts,
           jsonb_build_object(
             'auctionTransactionId', at.auction_transaction_id, 'parentId', at.parent_id,
             'itemName', i.name, 'rate', at.rate, 'quantity', at.quantity, 'bag', at.bag, 'chungi', at.chungi,
             'auctionDate', a.auction_date, 'partyName', coalesce(kp.name, ''), 'deviceName', dd.name,
             'isOld', at.is_old,
             'bagWiseQuantityArray', to_jsonb(string_to_array(coalesce(at.bag_wise_quantity, ''), ',', '')::float8[]),
             'bagWiseQuantity', at.bag_wise_quantity,
             'itemTotal', round(legacy_txn_amount(at.rate, coalesce(at.chungi, 0), at.quantity, at.bag))
           ) j
    from auction_transaction at
    join auction a on a.auction_id = at.auction_id
    join items i on a.item_id = i.item_id
    left join party kp on a.kisan_id = kp.party_id
    join device_details dd on dd.id = a.device_id
    where at.vyapari_id = p_vyapari_id and a.auction_date >= p_day and a.auction_date < p_day + 1
      and at.is_old = 'N'
  ),
  groups as (
    select grp, min(ts) first_ts, jsonb_agg(j order by ts) items from rows group by grp
  )
  select jsonb_build_object(
    'currentOutstanding', coalesce((select owed_amount from party where party_id = p_vyapari_id), 0),
    'billList', coalesce((select jsonb_agg(items order by first_ts, grp) from groups), '[]'::jsonb),
    'billTotal', coalesce((select sum((items->-1->>'itemTotal')::numeric) from groups), 0))
$$;

create or replace function legacy_vyapari_bill_entity(p_id bigint) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', b.id, 'vyapariId', b.vyapari_id, 'vyapariName', b.vyapari_name,
    'billDate', to_char(b.bill_date, 'YYYY-MM-DD'), 'currentOutstanding', b.current_outstanding,
    'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'vyapariBillItems', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'itemName', i.item_name, 'bag', i.bag, 'rate', i.rate, 'quantity', i.quantity,
        'itemTotal', i.item_total, 'createdAt', i.created_at, 'updatedAt', i.updated_at) order by i.id)
      from vyapari_bill_item i where i.vyapari_bill_id = b.id), '[]'::jsonb))
  from vyapari_bill b where b.id = p_id
$$;

-- POST /vyapari-bill — saves VyapariBill + items as sent (the frontend's
-- previous_remaining/total have no column, so currentOutstanding stays null,
-- as it did on the old server)
create or replace function legacy_save_vyapari_bill(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_id bigint;
begin
  insert into vyapari_bill (vyapari_id, vyapari_name, bill_date, current_outstanding)
  values (p->>'vyapariId', p->>'vyapariName', (p->>'billDate')::date, nullif(p->>'currentOutstanding', '')::numeric)
  returning id into v_id;

  insert into vyapari_bill_item (vyapari_bill_id, item_name, bag, rate, quantity, item_total)
  select v_id, i->>'itemName', nullif(i->>'bag', '')::integer, nullif(i->>'rate', '')::numeric,
         nullif(i->>'quantity', '')::numeric, nullif(i->>'itemTotal', '')::numeric
  from jsonb_array_elements(coalesce(p->'vyapariBillItems', '[]'::jsonb)) with ordinality t(i, ord)
  order by ord;

  return legacy_vyapari_bill_entity(v_id);
end;
$$;

-- GET /vyapari-bill — the Spring Page (size 1, newest first) the old server
-- returned, or null when that page is empty
create or replace function legacy_get_vyapari_bill(p_vyapari_id text, p_bill_date date, p_index integer) returns jsonb
language plpgsql stable as $$
declare
  v_total bigint;
  v_id bigint;
  v_sort jsonb := '{"sorted": false, "unsorted": true, "empty": true}';
begin
  if p_index < 0 then raise exception 'Page index must not be less than zero'; end if;
  select count(*) into v_total from vyapari_bill where vyapari_id = p_vyapari_id and bill_date = p_bill_date;
  select id into v_id from vyapari_bill where vyapari_id = p_vyapari_id and bill_date = p_bill_date
  order by id desc offset p_index limit 1;
  if v_id is null then return null; end if;
  return jsonb_build_object(
    'content', jsonb_build_array(legacy_vyapari_bill_entity(v_id)),
    'pageable', jsonb_build_object('sort', v_sort, 'pageNumber', p_index, 'pageSize', 1, 'offset', p_index,
                                   'paged', true, 'unpaged', false),
    'last', p_index >= v_total - 1, 'totalPages', v_total, 'totalElements', v_total, 'sort', v_sort,
    'number', p_index, 'first', p_index = 0, 'numberOfElements', 1, 'size', 1, 'empty', false);
end;
$$;

-- ---------------------------------------------------------------- devices

create or replace function legacy_device_entity(d device_details) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', d.id, 'name', d.name, 'creationDate', d.creation_date,
                            'updationTime', d.updation_time, 'status', d.status)
$$;

-- GET /device/listDevices — any of the four statuses, all when none given
create or replace function legacy_list_devices(p_statuses text[]) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(legacy_device_entity(d) order by d.id), '[]'::jsonb)
  from device_details d
  where coalesce(cardinality(p_statuses), 0) = 0 or d.status = any(p_statuses)
$$;
