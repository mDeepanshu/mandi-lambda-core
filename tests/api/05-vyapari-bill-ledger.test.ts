import { describe, expect, it } from 'vitest';
import { api, unwrap, today } from './helpers/client';
import { getSeed, Seed } from './helpers/seed';
import { owed } from './helpers/party';

// Cross-checks between the three vyapari money views for the same data:
//   generateBill:  itemTotal = rate * quantity (chungi excluded), Σ = billTotal,
//                  currentOutstanding = party.owed_amount
//   ledger:        dr = (rate + chungi) * quantity, cr = vasuli amount,
//                  closing = opening + Σdr - Σcr = party.owed_amount (endDate = today)

const ledgerFor = async (s: Seed) => {
  const d = today();
  return unwrap<any>(
    await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=${d}&endDate=${d}`),
  );
};

const sumDrCr = (ledger: any) => {
  const txns: any[] = ledger?.transactions ?? [];
  return {
    dr: txns.reduce((sum, t) => sum + Number(t.dr ?? 0), 0),
    cr: txns.reduce((sum, t) => sum + Number(t.cr ?? 0), 0),
  };
};

describe('vyapari bill and ledger: numbers agree across views', () => {
  it('auction + vasuli move billTotal, ledger, and owed_amount consistently', async () => {
    const s = await getSeed();
    const d = today();
    const baseline = await owed(s.vyapariAId);
    const stamp = Date.now();

    const billBefore = unwrap<any>(
      await api.get(`/vyapari/generateBill?vyapariId=${s.vyapariAId}&date=${d}`),
    );
    expect(Number(billBefore.currentOutstanding)).toBeCloseTo(baseline, 2);
    const billTotalBefore = Number(billBefore.billTotal ?? 0);

    const ledgerBefore = await ledgerFor(s);
    expect(Number(ledgerBefore.closingAmount)).toBeCloseTo(baseline, 2);
    const before = sumDrCr(ledgerBefore);
    expect(Number(ledgerBefore.closingAmount)).toBeCloseTo(
      Number(ledgerBefore.openingAmount ?? 0) + before.dr - before.cr,
      2,
    );

    // add an auction: rate 40, chungi 2, qty 5
    const txnsBefore = await todaysTxnIds(s);
    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${d}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariAId, rate: 40, quantity: 5, bag: 1, chungi: 2 }],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    // and a vasuli of 120
    const vasuli = unwrap<any[]>(
      await api.post('/party/vasuliTrasaction', [
        { vyapariId: s.vyapariAId, date: `${d}T12:00:00`, amount: 120, remark: `TEST_LEDGER_${stamp}` },
      ]),
    );
    const vasuliId = String(vasuli[0].id);

    // owed moved by (40+2)*5 - 120 = +90
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(210 - 120, 2);

    // bill: +rate*qty = +200, chungi excluded; Σ itemTotal = billTotal;
    // currentOutstanding tracks owed_amount
    const billAfter = unwrap<any>(
      await api.get(`/vyapari/generateBill?vyapariId=${s.vyapariAId}&date=${d}`),
    );
    expect(Number(billAfter.billTotal)).toBeCloseTo(billTotalBefore + 40 * 5, 2);
    const flatItemTotal = (billAfter.billList ?? [])
      .flat()
      .reduce((sum: number, item: any) => sum + Number(item.itemTotal ?? 0), 0);
    expect(flatItemTotal).toBeCloseTo(Number(billAfter.billTotal), 2);
    expect(Number(billAfter.currentOutstanding)).toBeCloseTo(baseline + 90, 2);

    // ledger: dr +210 (chungi included), cr +120, closing = opening + Σdr - Σcr = owed
    const ledgerAfter = await ledgerFor(s);
    const after = sumDrCr(ledgerAfter);
    expect(after.dr - before.dr).toBeCloseTo(210, 2);
    expect(after.cr - before.cr).toBeCloseTo(120, 2);
    expect(Number(ledgerAfter.closingAmount)).toBeCloseTo(
      Number(ledgerAfter.openingAmount ?? 0) + after.dr - after.cr,
      2,
    );
    expect(Number(ledgerAfter.closingAmount)).toBeCloseTo(baseline + 90, 2);

    // ledger-list (selected vyaparis) returns a flat transaction array whose
    // dr/cr sums for this vyapari must match the single-vyapari ledger
    const listSelected = unwrap<any[]>(
      await api.post(`/vyapari/ledger-list?startDate=${d}&endDate=${d}`, [s.vyapariAId]),
    );
    const mineSelected = (listSelected ?? []).filter((t: any) => t.vyapari_id === s.vyapariAId);
    expect(mineSelected.length).toBeGreaterThanOrEqual(1);
    const selDr = mineSelected.reduce((sum, t) => sum + Number(t.dr ?? 0), 0);
    const selCr = mineSelected.reduce((sum, t) => sum + Number(t.cr ?? 0), 0);
    expect(selDr).toBeCloseTo(after.dr, 2);
    expect(selCr).toBeCloseTo(after.cr, 2);

    // neutralize: delete the auction txn, zero the vasuli
    const newTxns = (await todaysTxnIds(s)).filter((id) => !txnsBefore.includes(id));
    expect(newTxns).toHaveLength(1);
    unwrap(await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: newTxns }));
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id: vasuliId,
        amount: 0,
        vyapariId: s.vyapariAId,
        date: `${d}T12:00:00`,
        remark: `TEST_LEDGER_${stamp}_ZEROED`,
      }),
    );
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  // NOTE: /bills/vyapari-bill (snapshot save/get) is pinned as a dead endpoint
  // in 08-contract-mismatches — its RPCs don't exist in any stage's database.
});

describe('vyapari: query and body validation', () => {
  it.each([
    ['generateBill without vyapariId', `/vyapari/generateBill?date=${today()}`],
    ['generateBill without date', '/vyapari/generateBill?vyapariId=X'],
    ['generateBill with nothing', '/vyapari/generateBill'],
    ['ledger without vyapariId', `/vyapari/ledger?startDate=${today()}&endDate=${today()}`],
    ['ledger without startDate', `/vyapari/ledger?vyapariId=X&endDate=${today()}`],
    ['ledger without endDate', `/vyapari/ledger?vyapariId=X&startDate=${today()}`],
  ])('%s -> 400', async (_label, path) => {
    const r = await api.get(path);
    expect(r.status).toBe(400);
  });

  it.each([
    ['missing dates', '', ['X']],
    ['empty id array', `?startDate=${today()}&endDate=${today()}`, []],
    ['object body', `?startDate=${today()}&endDate=${today()}`, { ids: ['X'] }],
    ['empty-string id', `?startDate=${today()}&endDate=${today()}`, ['']],
  ])('ledger-list rejects %s with 400', async (_label, qs, body) => {
    const r = await api.post(`/vyapari/ledger-list${qs}`, body);
    expect(r.status).toBe(400);
  });

  it.each([
    ['missing vyapari_id_param', { amount_param: 100 }],
    ['missing amount_param', { vyapari_id_param: 'X' }],
    ['non-numeric amount_param', { vyapari_id_param: 'X', amount_param: 'lots' }],
  ])('notify-vasuli rejects %s with 400 before any message is sent', async (_label, body) => {
    const r = await api.post('/vyapari/notify-vasuli', body);
    expect(r.status).toBe(400);
  });
});

describe('vyapari: ledger semantics', () => {
  it('transactions carry tv codes: V rows debit (dr), T rows credit (cr)', async () => {
    const s = await getSeed();
    const ledger = await ledgerFor(s);
    const txns: any[] = ledger?.transactions ?? [];
    for (const t of txns) {
      expect(['V', 'T']).toContain(t.tv);
      if (Number(t.cr ?? 0) > 0) expect(t.tv).toBe('T');
    }
  });

  it('a far-past range has equal opening and closing (no transactions)', async () => {
    const s = await getSeed();
    const ledger = unwrap<any>(
      await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=2000-01-01&endDate=2000-01-02`),
    );
    expect(ledger?.transactions ?? []).toHaveLength(0);
    expect(Number(ledger.closingAmount ?? 0)).toBeCloseTo(Number(ledger.openingAmount ?? 0), 2);
  });

  it('the vyaparicode header nulls openingAmount in the response', async () => {
    const s = await getSeed();
    const d = today();
    const ledger = unwrap<any>(
      await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=${d}&endDate=${d}`, {
        headers: { vyaparicode: 'ANY' },
      }),
    );
    expect(ledger.openingAmount).toBeNull();
  });

  it('the vyaparicode header filters out non-validated transactions', async () => {
    const s = await getSeed();
    const d = today();
    const filteredBefore = unwrap<any>(
      await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=${d}&endDate=${d}`, {
        headers: { vyaparicode: 'ANY' },
      }),
    );
    const drBefore = sumDrCr(filteredBefore).dr;

    // create an (unvalidated) auction txn: (10 + 1) * 3 = 33
    const txnsBefore = await todaysTxnIds(s);
    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${d}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariAId, rate: 10, quantity: 3, bag: 1, chungi: 1 }],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );

    const filteredAfter = unwrap<any>(
      await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=${d}&endDate=${d}`, {
        headers: { vyaparicode: 'ANY' },
      }),
    );
    expect(sumDrCr(filteredAfter).dr).toBeCloseTo(drBefore, 2); // still hidden

    const unfiltered = unwrap<any>(
      await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=${d}&endDate=${d}`),
    );
    expect(sumDrCr(unfiltered).dr).toBeGreaterThanOrEqual(drBefore + 33 - 0.01); // visible

    // validate it -> now visible in the filtered ledger too
    unwrap(
      await api.patch(
        `/auction/mark-transaction-validated?fromDate=${encodeURIComponent(`${d} 00:00:00`)}&toDate=${encodeURIComponent(`${d} 23:59:59`)}&vyapariId=${s.vyapariAId}`,
      ),
    );
    const filteredValidated = unwrap<any>(
      await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=${d}&endDate=${d}`, {
        headers: { vyaparicode: 'ANY' },
      }),
    );
    expect(sumDrCr(filteredValidated).dr).toBeCloseTo(drBefore + 33, 2);

    // clean up the txn
    const newTxns = (await todaysTxnIds(s)).filter((id) => !txnsBefore.includes(id));
    unwrap(await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: newTxns }));
  });

  it('generateBill for a day with no transactions still reports currentOutstanding = owed', async () => {
    const s = await getSeed();
    const bill = unwrap<any>(
      await api.get(`/vyapari/generateBill?vyapariId=${s.vyapariAId}&date=2000-01-01`),
    );
    expect(Number(bill?.billTotal ?? 0)).toBe(0);
    expect((bill?.billList ?? []).flat()).toHaveLength(0);
    expect(Number(bill?.currentOutstanding ?? 0)).toBeCloseTo(await owed(s.vyapariAId), 2);
  });

  it('generateBill for an unknown vyapari does not fabricate money', async () => {
    const r = await api.get(`/vyapari/generateBill?vyapariId=TEST_NO_SUCH_VYAPARI&date=${today()}`);
    if (r.status === 200) {
      const bill = r.body.responseBody as any;
      expect(Number(bill?.billTotal ?? 0)).toBe(0);
    } else {
      expect([404, 500]).toContain(r.status);
    }
  });

  it('ledger for an unknown vyapari does not fabricate balances', async () => {
    const d = today();
    const r = await api.get(`/vyapari/ledger?vyapariId=TEST_NO_SUCH_VYAPARI&startDate=${d}&endDate=${d}`);
    if (r.status === 200) {
      const ledger = r.body.responseBody as any;
      expect(ledger?.transactions ?? []).toHaveLength(0);
    } else {
      expect([404, 500]).toContain(r.status);
    }
  });

  it('ledger continuity: opening of today equals closing of everything before today', async () => {
    const s = await getSeed();
    const d = today();
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yd = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;

    const pastLedger = unwrap<any>(
      await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=2000-01-01&endDate=${yd}`),
    );
    const todayLedger = unwrap<any>(
      await api.get(`/vyapari/ledger?vyapariId=${s.vyapariAId}&startDate=${d}&endDate=${d}`),
    );
    expect(Number(todayLedger.openingAmount ?? 0)).toBeCloseTo(Number(pastLedger.closingAmount ?? 0), 2);
  });

  it('generateBill billList entries are single-item arrays (the TS reshape)', async () => {
    const s = await getSeed();
    const d = today();

    // ensure at least one line exists today
    const txnsBefore = await todaysTxnIds(s);
    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${d}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariAId, rate: 12, quantity: 2, bag: 1, chungi: 0 }],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    const bill = unwrap<any>(await api.get(`/vyapari/generateBill?vyapariId=${s.vyapariAId}&date=${d}`));
    expect(Array.isArray(bill.billList)).toBe(true);
    expect(bill.billList.length).toBeGreaterThanOrEqual(1);
    for (const entry of bill.billList) {
      expect(Array.isArray(entry)).toBe(true);
      expect(entry).toHaveLength(1);
    }

    const newTxns = (await todaysTxnIds(s)).filter((id) => !txnsBefore.includes(id));
    unwrap(await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: newTxns }));
  });

  it('isolation: activity on vyapari B never moves A’s bill or ledger', async () => {
    const s = await getSeed();
    const d = today();
    const stamp = Date.now();

    const billABefore = unwrap<any>(
      await api.get(`/vyapari/generateBill?vyapariId=${s.vyapariAId}&date=${d}`),
    );
    const ledgerABefore = await ledgerFor(s);

    // give B an auction and a vasuli
    const txnsBeforeB = (
      unwrap<any>(
        await api.get(
          `/auction/list-auction-transaction?startDate=${encodeURIComponent(`${d} 00:00:00`)}&endDate=${encodeURIComponent(`${d} 23:59:59`)}`,
        ),
      )?.auctionTransactions ?? []
    )
      .filter((t: any) => t.vyapariId === s.vyapariBId)
      .map((t: any) => t.auctionTransactionId);

    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${d}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariBId, rate: 20, quantity: 2, bag: 1, chungi: 1 }],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    const vasuliB = unwrap<any[]>(
      await api.post('/party/vasuliTrasaction', [
        { vyapariId: s.vyapariBId, date: `${d}T12:00:00`, amount: 25, remark: `TEST_ISO_${stamp}` },
      ]),
    );

    const billAAfter = unwrap<any>(
      await api.get(`/vyapari/generateBill?vyapariId=${s.vyapariAId}&date=${d}`),
    );
    const ledgerAAfter = await ledgerFor(s);
    expect(Number(billAAfter.billTotal ?? 0)).toBeCloseTo(Number(billABefore.billTotal ?? 0), 2);
    expect(Number(ledgerAAfter.closingAmount)).toBeCloseTo(Number(ledgerABefore.closingAmount), 2);
    expect((ledgerAAfter.transactions ?? []).length).toBe((ledgerABefore.transactions ?? []).length);

    // clean up B
    const allB = (
      unwrap<any>(
        await api.get(
          `/auction/list-auction-transaction?startDate=${encodeURIComponent(`${d} 00:00:00`)}&endDate=${encodeURIComponent(`${d} 23:59:59`)}`,
        ),
      )?.auctionTransactions ?? []
    )
      .filter((t: any) => t.vyapariId === s.vyapariBId)
      .map((t: any) => t.auctionTransactionId)
      .filter((id: string) => !txnsBeforeB.includes(id));
    unwrap(await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: allB }));
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id: String(vasuliB[0].id),
        amount: 0,
        vyapariId: s.vyapariBId,
        date: `${d}T12:00:00`,
        remark: `TEST_ISO_Z_${stamp}`,
      }),
    );
  });

  it('ledger-list returns rows only for the requested vyaparis', async () => {
    const s = await getSeed();
    const d = today();
    const rows = unwrap<any[]>(
      await api.post(`/vyapari/ledger-list?startDate=${d}&endDate=${d}`, [s.vyapariAId]),
    );
    for (const t of rows ?? []) {
      expect(t.vyapari_id).toBe(s.vyapariAId);
    }
  });
});

async function todaysTxnIds(s: Seed): Promise<string[]> {
  const d = today();
  const body = unwrap<any>(
    await api.get(
      `/auction/list-auction-transaction?startDate=${encodeURIComponent(`${d} 00:00:00`)}&endDate=${encodeURIComponent(`${d} 23:59:59`)}`,
    ),
  );
  return (body?.auctionTransactions ?? [])
    .filter((t: any) => t.vyapariId === s.vyapariAId)
    .map((t: any) => t.auctionTransactionId);
}
