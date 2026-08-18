import { describe, expect, it } from 'vitest';
import { api, unwrap, today } from './helpers/client';
import { getSeed, Seed } from './helpers/seed';

// /auction/generate-ledger is the one endpoint with TS-side math
// (src/auction/service.ts): openingAmountSum / closingAmountSum are reduces
// over the RPC rows, and `sum` is the day's total business -- the total of
// every row's dayBill. (`sum` used to be a duplicate of closingAmountSum.)

describe('auction ledger (vasuli sheet): sums equal the sum of rows', () => {
  it('openingAmountSum, closingAmountSum, and sum match the row data', async () => {
    const d = today();
    const body = unwrap<any>(await api.get(`/auction/generate-ledger?startDate=${d}&endDate=${d}`));

    const rows: any[] = body?.vasuliList ?? [];
    const openingSum = rows.reduce((sum, r) => sum + (Number(r.openingAmount) || 0), 0);
    const closingSum = rows.reduce((sum, r) => sum + (Number(r.closingAmount) || 0), 0);
    const dayBillSum = rows.reduce(
      (sum, r) => sum + (r.dayBill ?? []).reduce((a: number, b: any) => a + (Number(b) || 0), 0),
      0
    );

    expect(Number(body.openingAmountSum)).toBeCloseTo(openingSum, 2);
    expect(Number(body.closingAmountSum)).toBeCloseTo(closingSum, 2);
    expect(Number(body.sum)).toBeCloseTo(dayBillSum, 2);
    // NOTE: this report's per-row closing balance uses different semantics
    // than /vyapari/ledger (observed: not equal to party.owed_amount), so the
    // RPC rows are treated as a black box; only the TS-side sums are pinned.
  });

  it('missing startDate -> 400', async () => {
    const r = await api.get('/auction/generate-ledger');
    expect(r.status).toBe(400);
  });

  it('endDate is optional and defaults to the startDate window', async () => {
    const d = today();
    const withEnd = unwrap<any>(await api.get(`/auction/generate-ledger?startDate=${d}&endDate=${d}`));
    const withoutEnd = unwrap<any>(await api.get(`/auction/generate-ledger?startDate=${d}`));
    expect(Number(withoutEnd.closingAmountSum)).toBeCloseTo(Number(withEnd.closingAmountSum), 2);
    expect(Number(withoutEnd.openingAmountSum)).toBeCloseTo(Number(withEnd.openingAmountSum), 2);
  });

  it('rows expose partyId, partyName, and numeric balances', async () => {
    const d = today();
    const body = unwrap<any>(await api.get(`/auction/generate-ledger?startDate=${d}&endDate=${d}`));
    for (const r of (body?.vasuliList ?? []).slice(0, 5)) {
      expect(typeof r.partyId).toBe('string');
      expect(typeof r.partyName).toBe('string');
      expect(Number.isFinite(Number(r.closingAmount ?? 0))).toBe(true);
      expect(Number.isFinite(Number(r.openingAmount ?? 0))).toBe(true);
    }
  });

  it('sums are always internally consistent regardless of the date', async () => {
    const body = unwrap<any>(await api.get('/auction/generate-ledger?startDate=2000-01-01&endDate=2000-01-01'));
    const rows: any[] = body?.vasuliList ?? [];
    const closingSum = rows.reduce((sum, r) => sum + (Number(r.closingAmount) || 0), 0);
    const dayBillSum = rows.reduce(
      (sum, r) => sum + (r.dayBill ?? []).reduce((a: number, b: any) => a + (Number(b) || 0), 0),
      0
    );
    expect(Number(body.closingAmountSum)).toBeCloseTo(closingSum, 2);
    expect(Number(body.sum)).toBeCloseTo(dayBillSum, 2);
  });
});

// ---------------------------------------------------------------------------
// Regressions for the generate_auction_ledger fixes (db/fix_ledger_closing_
// balance.sql, 2026-07-19). Two bugs, both invisible to the sum-only tests
// above because those treat the RPC rows as a black box:
//
//  1. closingBalance rolled back activity with `auction_date > end_time`.
//     end_time is a date, so the comparison casts to MIDNIGHT and subtracted
//     the end date's own activity back out -- closing was the balance at the
//     START of the end date. With startDate == endDate (the vasuli sheet's
//     normal call) opening and closing became byte-identical expressions, so
//     the whole day's business never showed up.
//
//  2. The rollback subqueries counted `is_old='Y'` history rows while dayBill
//     filtered them out, so an edited transaction was charged twice.
//
// These pin per-row behaviour: opening is the balance BEFORE the day, closing
// is the balance AFTER it, and the gap is exactly the day's net activity.
// ---------------------------------------------------------------------------

interface LedgerRow {
  openingAmount: number;
  closingAmount: number;
  dayBill: number[];
}

/** This party's row for `date`. Absent rows are all-zero (the RPC drops rows with no balance and no activity). */
async function ledgerRow(vyapariId: string, date = today()): Promise<LedgerRow> {
  const body = unwrap<any>(await api.get(`/auction/generate-ledger?startDate=${date}&endDate=${date}`));
  const hit = (body?.vasuliList ?? []).find((r: any) => String(r.partyId) === String(vyapariId));
  return {
    openingAmount: Number(hit?.openingAmount ?? 0),
    closingAmount: Number(hit?.closingAmount ?? 0),
    dayBill: (hit?.dayBill ?? []).map((n: any) => Number(n) || 0),
  };
}

const dayBillTotal = (r: LedgerRow) => r.dayBill.reduce((a, b) => a + b, 0);

async function createAuction(
  s: Seed,
  buy: { rate: number; quantity: number; chungi: number; bag?: number },
  auctionDay = today(),
) {
  return unwrap(
    await api.post(
      '/auction',
      [
        {
          kisanId: s.kisanId,
          itemId: s.itemId,
          auctionDate: `${auctionDay}T12:00:00`,
          buyItems: [{ vyapariId: s.vyapariAId, bag: buy.bag ?? 2, ...buy }],
        },
      ],
      { deviceId: s.deviceId },
    ),
  );
}

/** All of this party's transactions filed under `day` (header-date window). */
async function listOn(day: string, vyapariId: string): Promise<any[]> {
  const qs = `startDate=${encodeURIComponent(`${day} 00:00:00`)}&endDate=${encodeURIComponent(`${day} 23:59:59`)}`;
  const body = unwrap<any>(await api.get(`/auction/list-auction-transaction?${qs}`));
  return (body?.auctionTransactions ?? []).filter((t: any) => t.vyapariId === vyapariId);
}

const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// create_auction_bulk_with_crate stamps auction_transaction.auction_date with
// NOW() -- the DB's clock, in UTC -- and ignores the payload's auctionDate for
// that row (the payload date only reaches `auction` and `crate_transaction`).
// The mandi runs on IST, so between 18:30 and 24:00 UTC the server's date is
// already a day behind the local one. These tests therefore never assume which
// day a transaction lands on: they list across a +/-1 day window and read the
// date back off the row. `serverDay` is that date.
const wideWindow = () =>
  `startDate=${encodeURIComponent(`${shift(-1)} 00:00:00`)}&endDate=${encodeURIComponent(`${shift(1)} 23:59:59`)}`;

async function listTxns(vyapariId: string): Promise<any[]> {
  const body = unwrap<any>(await api.get(`/auction/list-auction-transaction?${wideWindow()}`));
  return (body?.auctionTransactions ?? []).filter((t: any) => t.vyapariId === vyapariId);
}

const txnIds = async (vyapariId: string): Promise<string[]> =>
  (await listTxns(vyapariId)).map((t) => t.auctionTransactionId);

const serverDay = (txn: any): string => String(txn.auctionDate).slice(0, 10);

describe('auction ledger: opening is before the day, closing is after it', () => {
  it("an auction raises closingAmount by its value and leaves openingAmount alone", async () => {
    const s = await getSeed();
    const idsBefore = await txnIds(s.vyapariAId);

    // (100 + 5) * 10 = 1050
    await createAuction(s, { rate: 100, quantity: 10, chungi: 5 });
    const created = (await listTxns(s.vyapariAId)).filter(
      (t) => !idsBefore.includes(t.auctionTransactionId),
    );
    expect(created).toHaveLength(1);
    const id = created[0].auctionTransactionId;
    const day = serverDay(created[0]);

    // Read with the auction in place, then remove it and read again. The
    // bug: opening and closing were the same expression, so an auction moved
    // BOTH by 1050 and the day's business never showed up as a gap.
    const withAuction = await ledgerRow(s.vyapariAId, day);
    await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: [id] });
    const without = await ledgerRow(s.vyapariAId, day);

    expect(withAuction.openingAmount).toBeCloseTo(without.openingAmount, 2);
    expect(withAuction.closingAmount - without.closingAmount).toBeCloseTo(1050, 2);
    expect(dayBillTotal(withAuction) - dayBillTotal(without)).toBeCloseTo(1050, 2);
  });

  it('a vasuli lowers closingAmount, leaves openingAmount and dayBill alone', async () => {
    const s = await getSeed();
    const before = await ledgerRow(s.vyapariAId);
    const stamp = Date.now();

    const rows = unwrap<any[]>(
      await api.post('/party/vasuliTrasaction', [
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 300, remark: `TEST_LEDGER_${stamp}` },
      ]),
    );
    const vasuliId = String(rows[0].id);

    try {
      const after = await ledgerRow(s.vyapariAId);
      expect(after.openingAmount - before.openingAmount).toBeCloseTo(0, 2);
      expect(after.closingAmount - before.closingAmount).toBeCloseTo(-300, 2);
      // a payment is not business done -- dayBill must not move
      expect(dayBillTotal(after)).toBeCloseTo(dayBillTotal(before), 2);
    } finally {
      unwrap(
        await api.put('/vyapari/edit-vasuli', {
          id: vasuliId,
          amount: 0,
          vyapariId: s.vyapariAId,
          date: `${today()}T12:00:00`,
          remark: `TEST_LEDGER_${stamp}_ZEROED`,
        }),
      );
    }
  });

  it('an edited transaction is counted once, not once per is_old revision', async () => {
    const s = await getSeed();
    const idsBefore = await txnIds(s.vyapariAId);

    // create (100 + 5) * 10 = 1050 ...
    await createAuction(s, { rate: 100, quantity: 10, chungi: 5 });
    const created = (await listTxns(s.vyapariAId)).filter(
      (t) => !idsBefore.includes(t.auctionTransactionId),
    );
    expect(created).toHaveLength(1);
    const day = serverDay(created[0]);

    // ... then edit to (120 + 5) * 8 = 1000. The edit RPC keeps the original
    // as an is_old='Y' history row and recreates the live one under a new id.
    unwrap(
      await api.post('/auction/edit-auction-transaction', {
        auctionTransactionId: created[0].auctionTransactionId,
        vyapariId: s.vyapariAId,
        rate: 120,
        quantity: 8,
        bag: 2,
        chungi: 5,
      }),
    );
    const live = (await txnIds(s.vyapariAId)).filter((id) => !idsBefore.includes(id));
    expect(live).toHaveLength(1);

    const edited = await ledgerRow(s.vyapariAId, day);
    // Deleting the live row leaves the is_old='Y' history row behind -- the
    // bug was that the rollback subqueries still counted it, so closing moved
    // by 1050 + 1000 = 2050 and disagreed with dayBill. Now the history row
    // must be invisible and closing must land back exactly where it started.
    await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: live });
    const gone = await ledgerRow(s.vyapariAId, day);

    expect(edited.closingAmount - gone.closingAmount).toBeCloseTo(1000, 2);
    expect(dayBillTotal(edited) - dayBillTotal(gone)).toBeCloseTo(1000, 2);
    expect(edited.openingAmount).toBeCloseTo(gone.openingAmount, 2);
  });

  it('closing - opening equals the day net (business done - payments taken)', async () => {
    const s = await getSeed();
    const idsBefore = await txnIds(s.vyapariAId);
    const stamp = Date.now();
    const gap = (r: LedgerRow) => r.closingAmount - r.openingAmount;

    // (40 + 10) * 3 = 150 of business, 90 collected => net +60 on the day
    await createAuction(s, { rate: 40, quantity: 3, chungi: 10 });
    const created = (await listTxns(s.vyapariAId)).filter(
      (t) => !idsBefore.includes(t.auctionTransactionId),
    );
    expect(created).toHaveLength(1);
    const day = serverDay(created[0]);
    const withAuction = await ledgerRow(s.vyapariAId, day);

    // vasuli honours the date it is given, so pin it to the auction's day
    const rows = unwrap<any[]>(
      await api.post('/party/vasuliTrasaction', [
        { vyapariId: s.vyapariAId, date: `${day}T12:00:00`, amount: 90, remark: `TEST_LEDGER_NET_${stamp}` },
      ]),
    );
    const vasuliId = String(rows[0].id);
    const withBoth = await ledgerRow(s.vyapariAId, day);

    await api.del('/auction/delete-auction-transaction', {
      auctionTransactionIds: [created[0].auctionTransactionId],
    });
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id: vasuliId,
        amount: 0,
        vyapariId: s.vyapariAId,
        date: `${day}T12:00:00`,
        remark: `TEST_LEDGER_NET_${stamp}_ZEROED`,
      }),
    );
    const clean = await ledgerRow(s.vyapariAId, day);

    // The core ledger invariant: the opening/closing gap is the day's net.
    // Business widens it, payments narrow it, and removing both closes it
    // back up. Before the fix the gap was always 0 -- nothing moved it.
    expect(gap(withAuction) - gap(clean)).toBeCloseTo(150, 2);
    expect(gap(withAuction) - gap(withBoth)).toBeCloseTo(90, 2);
    expect(gap(withBoth) - gap(clean)).toBeCloseTo(60, 2);
    expect(dayBillTotal(withAuction) - dayBillTotal(clean)).toBeCloseTo(150, 2);
  });
});

// ---------------------------------------------------------------------------
// Backdated entries (db/auction_txn_date_from_payload*.sql, 2026-07-19).
//
// auction_transaction.auction_date now inherits the operator-entered
// auctionDate instead of the server clock, so a backdated entry files on the
// backdate in EVERY report. Before this, the header got the backdate but the
// transaction row got "now" -- AUCTION ENTRIES showed the entry on the
// backdate while the vasuli sheet charged it to today, and the two screens
// could never reconcile. Entry time moved to the created_at audit column.
//
// The probes use dates in 2020: far enough back that no live or test data can
// collide, and any assertion there is exact rather than delta-against-noise.
// ---------------------------------------------------------------------------

describe('backdated entries file on the backdate in both reports', () => {
  const BACKDATE = '2020-01-15';

  it('a backdated POST lands on the backdate everywhere, and not on today', async () => {
    const s = await getSeed();
    const todayRow = await ledgerRow(s.vyapariAId);
    const backBefore = await ledgerRow(s.vyapariAId, BACKDATE);

    // rate 19 x qty 1 = 19, entered "for" 2020-01-15
    await createAuction(s, { rate: 19, quantity: 1, chungi: 0 }, BACKDATE);

    const filed = (await listOn(BACKDATE, s.vyapariAId)).filter((t) => Number(t.rate) === 19);
    expect(filed).toHaveLength(1);

    try {
      // both date columns carry the backdate -- header AND transaction row
      expect(String(filed[0].auctionSubmitDate).slice(0, 10)).toBe(BACKDATE);
      expect(String(filed[0].auctionDate).slice(0, 10)).toBe(BACKDATE);

      // the vasuli sheet bills it on the backdate...
      const backAfter = await ledgerRow(s.vyapariAId, BACKDATE);
      expect(dayBillTotal(backAfter) - dayBillTotal(backBefore)).toBeCloseTo(19, 2);

      // ...and today's sheet is untouched
      const todayAfter = await ledgerRow(s.vyapariAId);
      expect(dayBillTotal(todayAfter)).toBeCloseTo(dayBillTotal(todayRow), 2);
    } finally {
      await api.del('/auction/delete-auction-transaction', {
        auctionTransactionIds: [filed[0].auctionTransactionId],
      });
    }
  });

  it('moving a transaction to another date refiles it there (old-server edit flow)', async () => {
    const s = await getSeed();
    const MOVE_TO = '2020-01-16';
    const idsBefore = await txnIds(s.vyapariAId);

    // enter today: rate 23 x qty 1 = 23
    await createAuction(s, { rate: 23, quantity: 1, chungi: 0 });
    const created = (await listTxns(s.vyapariAId)).filter(
      (t) => !idsBefore.includes(t.auctionTransactionId),
    );
    expect(created).toHaveLength(1);

    // PATCH /auction/edit-auction: remove it from its auction and recreate it
    // under a new auction (same kisan, same item) dated MOVE_TO -- deleting
    // the old header if it emptied. This is the old-server date-change flow.
    unwrap(
      await api.patch('/auction/edit-auction', {
        deleteAuctionTransactionDto: { auctionTransactionIds: [created[0].auctionTransactionId] },
        addAuctionDtos: [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            deviceId: s.deviceId,
            auctionDate: `${MOVE_TO}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariAId, bag: 1, rate: 23, quantity: 1, chungi: 0 }],
          },
        ],
      }, { deviceId: s.deviceId }),
    );

    const moved = (await listOn(MOVE_TO, s.vyapariAId)).filter((t) => Number(t.rate) === 23);
    expect(moved).toHaveLength(1);

    try {
      // gone from today (the recreate is a hard delete, not an is_old chain)
      const todayIds = await txnIds(s.vyapariAId);
      expect(todayIds).not.toContain(created[0].auctionTransactionId);

      // filed on the target date in both columns and in the vasuli sheet
      expect(String(moved[0].auctionSubmitDate).slice(0, 10)).toBe(MOVE_TO);
      expect(String(moved[0].auctionDate).slice(0, 10)).toBe(MOVE_TO);
      const backRow = await ledgerRow(s.vyapariAId, MOVE_TO);
      expect(dayBillTotal(backRow)).toBeGreaterThanOrEqual(23);
    } finally {
      await api.del('/auction/delete-auction-transaction', {
        auctionTransactionIds: [moved[0].auctionTransactionId],
      });
    }
  });
});
