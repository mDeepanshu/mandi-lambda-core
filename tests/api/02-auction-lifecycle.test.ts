import { describe, expect, it } from 'vitest';
import { api, unwrap, today } from './helpers/client';
import { getSeed, Seed } from './helpers/seed';
import { owed } from './helpers/party';

// Dev/his DB invariant: vyapari owed_amount += (rate + chungi) * quantity on
// auction create; delete reverses it exactly (see db/chungi_formula_his.sql).

const listWindow = () => {
  const d = today();
  return `startDate=${encodeURIComponent(`${d} 00:00:00`)}&endDate=${encodeURIComponent(`${d} 23:59:59`)}`;
};

// No deviceId filter: a listing scoped to the seed device would miss rows
// recreated under another device. The TEST_ vyaparis are only ever used by
// this suite, which makes vyapariId a safe scope on shared dev data.
async function listTxns(vyapariId: string): Promise<any[]> {
  const body = unwrap<any>(await api.get(`/auction/list-auction-transaction?${listWindow()}`));
  return (body ?? []).filter((t: any) => t.vyapariId === vyapariId);
}

async function createAuction(
  s: Seed,
  buy: { rate: number; quantity: number; chungi: number; bag?: number; bagWiseQuantity?: number[] },
  vyapariId?: string,
) {
  return unwrap(
    await api.post(
      '/auction',
      [
        {
          kisanId: s.kisanId,
          itemId: s.itemId,
          auctionDate: `${today()}T12:00:00`,
          buyItems: [{ vyapariId: vyapariId ?? s.vyapariAId, bag: buy.bag ?? 2, ...buy }],
        },
      ],
      { deviceId: s.deviceId },
    ),
  );
}

async function deleteTxns(ids: string[]) {
  unwrap(await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: ids }));
}

describe('auction lifecycle: owed_amount follows (rate + chungi) * quantity', () => {
  it('create -> edit -> validate -> delete returns owed_amount to baseline', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const txnsBefore = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    // create: (100 + 5) * 10 = 1050
    await createAuction(s, { rate: 100, quantity: 10, chungi: 5 });
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo((100 + 5) * 10, 2);

    const created = (await listTxns(s.vyapariAId)).filter(
      (t) => !txnsBefore.includes(t.auctionTransactionId),
    );
    expect(created).toHaveLength(1);
    const txn = created[0];
    expect(Number(txn.amount)).toBeCloseTo((100 + 5) * 10, 2);
    expect(Number(txn.rate)).toBe(100);
    expect(Number(txn.quantity)).toBe(10);
    expect(Number(txn.chungi)).toBe(5);

    // edit: rate 100->120, qty 10->8 => owed delta becomes (120 + 5) * 8 = 1000
    unwrap(
      await api.post('/auction/edit-auction-transaction', {
        auctionTransactionId: txn.auctionTransactionId,
        vyapariId: s.vyapariAId,
        rate: 120,
        quantity: 8,
        bag: 2,
        chungi: 5,
      }),
    );
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo((120 + 5) * 8, 2);

    // The edit RPC recreates the row (parent_id/is_old chain), so the listing
    // now shows a NEW transaction id; find it by exclusion.
    const afterEdit = (await listTxns(s.vyapariAId)).filter(
      (t) => !txnsBefore.includes(t.auctionTransactionId),
    );
    expect(afterEdit).toHaveLength(1);
    const editedTxn = afterEdit[0];
    expect(Number(editedTxn.amount)).toBeCloseTo((120 + 5) * 8, 2);
    expect(Number(editedTxn.rate)).toBe(120);

    // validate is money-neutral
    const d = today();
    const validated = unwrap<any>(
      await api.patch(
        `/auction/mark-transaction-validated?fromDate=${encodeURIComponent(`${d} 00:00:00`)}&toDate=${encodeURIComponent(`${d} 23:59:59`)}&vyapariId=${s.vyapariAId}`,
      ),
    );
    expect(Number(validated ?? 0)).toBeGreaterThanOrEqual(1);
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo((120 + 5) * 8, 2);

    // delete reverses fully (the recreated row, not the original id)
    await deleteTxns([editedTxn.auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('PATCH /auction/edit-auction (delete + re-add) nets to new - old', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const txnsBefore = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    // old: (50 + 2) * 4 = 208
    await createAuction(s, { rate: 50, quantity: 4, chungi: 2 });
    const created = (await listTxns(s.vyapariAId)).filter(
      (t) => !txnsBefore.includes(t.auctionTransactionId),
    );
    expect(created).toHaveLength(1);
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo((50 + 2) * 4, 2);

    // replace with new: (60 + 3) * 5 = 315
    unwrap(
      await api.patch(
        '/auction/edit-auction',
        {
          deleteAuctionTransactionDto: {
            auctionTransactionIds: [created[0].auctionTransactionId],
          },
          addAuctionDtos: [
            {
              kisanId: s.kisanId,
              itemId: s.itemId,
              auctionDate: `${today()}T12:00:00`,
              buyItems: [{ vyapariId: s.vyapariAId, rate: 60, quantity: 5, bag: 1, chungi: 3 }],
            },
          ],
        },
        { deviceId: s.deviceId },
      ),
    );
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo((60 + 3) * 5, 2);

    // clean the replacement so this file leaves owed_amount at its baseline
    const replacement = (await listTxns(s.vyapariAId)).filter(
      (t) => !txnsBefore.includes(t.auctionTransactionId) && Number(t.rate) === 60,
    );
    expect(replacement).toHaveLength(1);
    await deleteTxns([replacement[0].auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });
});

describe('auction: money matrix — owed delta = (rate + chungi) * quantity, delete reverses', () => {
  // NOTE: chungi must be an integer — the auction_transaction.chungi column is
  // int, and fractional values make the create RPC fail (pinned below).
  it.each([
    [1, 0, 1],
    [0.5, 0, 2],
    [7.25, 1, 4],
    [100, 5, 10],
    [999.99, 0, 1],
    [12.5, 2, 8],
    [250, 10, 0.5],
    [1000, 0, 100],
    [45.5, 4, 20],
    [3, 1, 333],
    [9999, 99, 3],
    [0.01, 0, 1000],
    [88, 12, 2.25],
    [500, 25, 6],
    [123.45, 7, 9],
    [60, 3, 15],
    [199.99, 0, 7],
    [75, 8, 12],
    [2, 1, 40],
    [850, 15, 1.5],
  ])('rate=%s chungi=%s qty=%s', async (rate, chungi, quantity) => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    await createAuction(s, { rate, quantity, chungi });
    const expected = (rate + chungi) * quantity;
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(expected, 2);

    const mine = (await listTxns(s.vyapariAId)).filter(
      (t) => !before.includes(t.auctionTransactionId),
    );
    expect(mine).toHaveLength(1);
    expect(Number(mine[0].amount)).toBeCloseTo(expected, 2);

    await deleteTxns([mine[0].auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });
});

describe('auction: multi-item and multi-party creates', () => {
  it('three buyItems for the same vyapari sum their amounts', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${today()}T12:00:00`,
            buyItems: [
              { vyapariId: s.vyapariAId, rate: 10, quantity: 2, bag: 1, chungi: 1 }, // 22
              { vyapariId: s.vyapariAId, rate: 20, quantity: 3, bag: 1, chungi: 0 }, // 60
              { vyapariId: s.vyapariAId, rate: 5.5, quantity: 4, bag: 1, chungi: 1 }, // 26
            ],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(22 + 60 + 26, 2);

    const mine = (await listTxns(s.vyapariAId)).filter(
      (t) => !before.includes(t.auctionTransactionId),
    );
    expect(mine).toHaveLength(3);
    await deleteTxns(mine.map((t) => t.auctionTransactionId));
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('buyItems split across two vyaparis charge each their own amount', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const baseB = await owed(s.vyapariBId);
    const beforeA = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);
    const beforeB = (await listTxns(s.vyapariBId)).map((t) => t.auctionTransactionId);

    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${today()}T12:00:00`,
            buyItems: [
              { vyapariId: s.vyapariAId, rate: 30, quantity: 4, bag: 1, chungi: 2 }, // 128 -> A
              { vyapariId: s.vyapariBId, rate: 50, quantity: 2, bag: 1, chungi: 5 }, // 110 -> B
            ],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(128, 2);
    expect((await owed(s.vyapariBId)) - baseB).toBeCloseTo(110, 2);

    const newA = (await listTxns(s.vyapariAId)).filter((t) => !beforeA.includes(t.auctionTransactionId));
    const newB = (await listTxns(s.vyapariBId)).filter((t) => !beforeB.includes(t.auctionTransactionId));
    await deleteTxns([...newA, ...newB].map((t) => t.auctionTransactionId));
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
    expect(await owed(s.vyapariBId)).toBeCloseTo(baseB, 2);
  });

  it('two auctions in one POST both land', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${today()}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariAId, rate: 11, quantity: 2, bag: 1, chungi: 0 }], // 22
          },
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${today()}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariAId, rate: 13, quantity: 3, bag: 1, chungi: 1 }], // 42
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(22 + 42, 2);

    const mine = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    expect(mine).toHaveLength(2);
    await deleteTxns(mine.map((t) => t.auctionTransactionId));
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });
});

describe('auction: edit-transaction edge cases', () => {
  it('reassigning a transaction to another vyapari moves the full amount', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const baseB = await owed(s.vyapariBId);
    const beforeA = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);
    const beforeB = (await listTxns(s.vyapariBId)).map((t) => t.auctionTransactionId);

    await createAuction(s, { rate: 80, quantity: 5, chungi: 4 }); // 420 on A
    const created = (await listTxns(s.vyapariAId)).filter((t) => !beforeA.includes(t.auctionTransactionId));
    expect(created).toHaveLength(1);

    unwrap(
      await api.post('/auction/edit-auction-transaction', {
        auctionTransactionId: created[0].auctionTransactionId,
        vyapariId: s.vyapariBId,
        rate: 80,
        quantity: 5,
        bag: 2,
        chungi: 4,
      }),
    );
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
    expect((await owed(s.vyapariBId)) - baseB).toBeCloseTo(420, 2);

    const moved = (await listTxns(s.vyapariBId)).filter((t) => !beforeB.includes(t.auctionTransactionId));
    expect(moved).toHaveLength(1);
    await deleteTxns([moved[0].auctionTransactionId]);
    expect(await owed(s.vyapariBId)).toBeCloseTo(baseB, 2);
  });

  it('editing only chungi shifts owed by quantity * delta-chungi', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    await createAuction(s, { rate: 50, quantity: 10, chungi: 0 }); // 500
    const created = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    unwrap(
      await api.post('/auction/edit-auction-transaction', {
        auctionTransactionId: created[0].auctionTransactionId,
        vyapariId: s.vyapariAId,
        rate: 50,
        quantity: 10,
        bag: 2,
        chungi: 5,
      }),
    );
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(550, 2);

    const edited = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    await deleteTxns(edited.map((t) => t.auctionTransactionId));
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('bagWiseQuantity round-trips through create and listing', async () => {
    const s = await getSeed();
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    await createAuction(s, { rate: 10, quantity: 30, chungi: 0, bag: 2, bagWiseQuantity: [10, 20] });
    const mine = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    expect(mine).toHaveLength(1);
    expect(mine[0].bagWiseQuantity).toBe('10,20');
    expect(mine[0].bagWiseQuantityArray).toEqual([10, 20]);
    await deleteTxns([mine[0].auctionTransactionId]);
  });

  it('quantity 0 is accepted and money-neutral', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    const r = await api.post(
      '/auction',
      [
        {
          kisanId: s.kisanId,
          itemId: s.itemId,
          auctionDate: `${today()}T12:00:00`,
          buyItems: [{ vyapariId: s.vyapariAId, rate: 100, quantity: 0, bag: 1, chungi: 5 }],
        },
      ],
      { deviceId: s.deviceId },
    );
    if (r.status === 200) {
      expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
      const mine = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
      if (mine.length) await deleteTxns(mine.map((t) => t.auctionTransactionId));
    } else {
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });
});

describe('auction: field aliases and coercion', () => {
  it('numeric-string rate and quantity are coerced ("45.5", "4")', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${today()}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariAId, rate: '45.5', quantity: '4', bag: 1, chungi: '2' }],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo((45.5 + 2) * 4, 2);

    const mine = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    await deleteTxns(mine.map((t) => t.auctionTransactionId));
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('edit-auction can replace two transactions with one in a single call', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    // create two: 30 + 70 = 100
    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${today()}T12:00:00`,
            buyItems: [
              { vyapariId: s.vyapariAId, rate: 15, quantity: 2, bag: 1, chungi: 0 }, // 30
              { vyapariId: s.vyapariAId, rate: 35, quantity: 2, bag: 1, chungi: 0 }, // 70
            ],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    const created = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    expect(created).toHaveLength(2);
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(100, 2);

    // replace both with one: (40 + 5) * 2 = 90
    unwrap(
      await api.patch(
        '/auction/edit-auction',
        {
          deleteAuctionTransactionDto: {
            auctionTransactionIds: created.map((t) => t.auctionTransactionId),
          },
          addAuctionDtos: [
            {
              kisanId: s.kisanId,
              itemId: s.itemId,
              auctionDate: `${today()}T12:00:00`,
              buyItems: [{ vyapariId: s.vyapariAId, rate: 40, quantity: 2, bag: 1, chungi: 5 }],
            },
          ],
        },
        { deviceId: s.deviceId },
      ),
    );
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(90, 2);

    const replacement = (await listTxns(s.vyapariAId)).filter(
      (t) => !before.includes(t.auctionTransactionId),
    );
    expect(replacement).toHaveLength(1);
    await deleteTxns(replacement.map((t) => t.auctionTransactionId));
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });
});

describe('auction: delete edge cases', () => {
  it('deleting the same transaction twice does not double-reverse', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    await createAuction(s, { rate: 25, quantity: 4, chungi: 0 }); // 100
    const mine = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    await deleteTxns([mine[0].auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);

    // the id no longer exists, so the second delete must SAY so -- the RPC
    // used to return true for a no-op, which twice hid failed cleanups
    const again = await api.del('/auction/delete-auction-transaction', {
      auctionTransactionIds: [mine[0].auctionTransactionId],
    });
    expect(again.status).toBe(404);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('deleting a nonexistent uuid -> 404, owed_amount untouched', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const r = await api.del('/auction/delete-auction-transaction', {
      auctionTransactionIds: ['00000000-0000-0000-0000-000000000000'],
    });
    expect(r.status).toBe(404);
    expect(r.body.responseMessage).toMatch(/no matching auction transactions/i);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('a mix of real and stale ids deletes the real ones (partial is not an error)', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);

    await createAuction(s, { rate: 31, quantity: 2, chungi: 0 }); // 62
    const mine = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    expect(mine).toHaveLength(1);

    // a stale id alongside a live one: the live row must still be deleted --
    // the end state matches what the caller asked for, and blocking on the
    // stale id would strand stale screens
    unwrap(
      await api.del('/auction/delete-auction-transaction', {
        auctionTransactionIds: [mine[0].auctionTransactionId, '00000000-0000-0000-0000-000000000000'],
      }),
    );
    const after = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);
    expect(after).not.toContain(mine[0].auctionTransactionId);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('a non-uuid transaction id is rejected, owed unchanged', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const r = await api.del('/auction/delete-auction-transaction', {
      auctionTransactionIds: ['not-a-uuid'],
    });
    expect([400, 500]).toContain(r.status);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });
});

// Old server's DeviceIdFilter on /auction/*: no header -> 400, anything but an
// APPROVED device id -> 401 "Invalid deviceId". Applies to every route.
describe('auction: deviceid header guard', () => {
  it('missing deviceid header -> 400', async () => {
    const s = await getSeed();
    const r = await api.post(
      '/auction',
      [{ kisanId: s.kisanId, itemId: s.itemId, buyItems: [{ vyapariId: s.vyapariAId, rate: 1, quantity: 1 }] }],
      { deviceId: null },
    );
    expect(r.status).toBe(400);
  });

  it('missing header is rejected on read routes too', async () => {
    const r = await api.get(`/auction/list-auction-transaction?${listWindow()}`, { deviceId: null });
    expect(r.status).toBe(400);
  });

  it.each([
    ['non-numeric', 'abc'],
    ['decimal', '12.5'],
    ['nonexistent', '999999999'],
  ])('%s deviceid header -> 401', async (_label, header) => {
    const s = await getSeed();
    const r = await api.post(
      '/auction',
      [{ kisanId: s.kisanId, itemId: s.itemId, buyItems: [{ vyapariId: s.vyapariAId, rate: 1, quantity: 1 }] }],
      { headers: { deviceid: header } },
    );
    expect(r.status).toBe(401);
  });

  it('a registered but not APPROVED device -> 401', async () => {
    const devices = unwrap<any[]>(await api.get('/device/listDevices?status=REQUESTED,REJECTED,APPROVED')) ?? [];
    let device = devices.find((d) => d.name === 'TEST_DEVICE_UNAPPROVED');
    if (!device) {
      device = unwrap<any>(await api.post('/device/register', { name: 'TEST_DEVICE_UNAPPROVED' }));
      if (Array.isArray(device)) device = device[0];
    }
    unwrap(await api.put(`/device/${device.id}/status?status=REJECTED`));
    const r = await api.get(`/auction/list-auction-transaction?${listWindow()}`, { deviceId: device.id });
    expect(r.status).toBe(401);
  });

  it('empty auction array -> 200 with an empty list (one boolean per auction)', async () => {
    const r = await api.post('/auction', []);
    expect(r.status).toBe(200);
    expect(r.body.responseBody).toEqual([]);
  });

  it('POST /auction answers one true per saved auction, like the old server', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);
    const one = { kisanId: s.kisanId, itemId: s.itemId, auctionDate: `${today()}T12:00:00` };
    const body = unwrap(
      await api.post('/auction', [
        { ...one, buyItems: [{ vyapariId: s.vyapariAId, rate: 3, quantity: 1, bags: 1 }] },
        { ...one, buyItems: [{ vyapariId: s.vyapariAId, rate: 4, quantity: 1, bags: 1 }] },
      ]),
    );
    expect(body).toEqual([true, true]);
    const mine = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    await deleteTxns(mine.map((t) => t.auctionTransactionId));
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });
});

describe('auction: POST /auction body validation', () => {
  const buildBody = (patch: Record<string, unknown>) => [
    {
      kisanId: 'TEST_KISAN_AUTO_ID',
      itemId: 'TEST_ITEM_AUTO_ID',
      buyItems: [{ vyapariId: 'TEST_VYAPARI_AUTO_A_ID', rate: 1, quantity: 1, bag: 1, chungi: 0 }],
      ...patch,
    },
  ];

  it.each([
    ['missing kisanId', buildBody({ kisanId: undefined })],
    ['empty kisanId', buildBody({ kisanId: '' })],
    ['empty buyItems array', buildBody({ buyItems: [] })],
    ['missing buyItems', buildBody({ buyItems: undefined })],
    ['buyItem without vyapariId', buildBody({ buyItems: [{ rate: 1, quantity: 1 }] })],
    ['buyItem with empty vyapariId', buildBody({ buyItems: [{ vyapariId: '', rate: 1 }] })],
    ['non-numeric rate', buildBody({ buyItems: [{ vyapariId: 'X', rate: 'ten', quantity: 1 }] })],
    ['non-numeric quantity', buildBody({ buyItems: [{ vyapariId: 'X', rate: 1, quantity: 'many' }] })],
    ['non-numeric chungi', buildBody({ buyItems: [{ vyapariId: 'X', rate: 1, quantity: 1, chungi: 'some' }] })],
    ['non-numeric bagWiseQuantity entry', buildBody({ buyItems: [{ vyapariId: 'X', rate: 1, quantity: 1, bagWiseQuantity: ['a'] }] })],
    ['object instead of array', { kisanId: 'X', buyItems: [{ vyapariId: 'Y', rate: 1 }] }],
  ])('rejects %s with 400', async (_label, body) => {
    const s = await getSeed();
    const r = await api.post('/auction', body, { deviceId: s.deviceId });
    expect(r.status).toBe(400);
  });
});

describe('auction: edit/delete/validate/list input validation', () => {
  const validEdit = {
    auctionTransactionId: '00000000-0000-0000-0000-000000000000',
    vyapariId: 'TEST_VYAPARI_AUTO_A_ID',
    rate: 1,
    quantity: 1,
    bag: 1,
    chungi: 0,
  };

  it.each([
    ['missing auctionTransactionId', { ...validEdit, auctionTransactionId: undefined }],
    ['missing vyapariId', { ...validEdit, vyapariId: undefined }],
    ['missing rate', { ...validEdit, rate: undefined }],
    ['missing quantity', { ...validEdit, quantity: undefined }],
    ['missing bag', { ...validEdit, bag: undefined }],
    ['missing chungi', { ...validEdit, chungi: undefined }],
    ['non-numeric rate', { ...validEdit, rate: 'x' }],
  ])('edit-auction-transaction rejects %s with 400', async (_label, body) => {
    const r = await api.post('/auction/edit-auction-transaction', body);
    expect(r.status).toBe(400);
  });

  it.each([
    ['missing auctionTransactionIds', {}],
    ['empty auctionTransactionIds', { auctionTransactionIds: [] }],
    ['empty-string id', { auctionTransactionIds: [''] }],
  ])('delete-auction-transaction rejects %s with 400', async (_label, body) => {
    const r = await api.del('/auction/delete-auction-transaction', body);
    expect(r.status).toBe(400);
  });

  it.each([
    ['missing fromDate', `toDate=${today()}&vyapariId=X`],
    ['missing toDate', `fromDate=${today()}&vyapariId=X`],
  ])('mark-transaction-validated rejects %s with 400', async (_label, qs) => {
    const r = await api.patch(`/auction/mark-transaction-validated?${qs}`);
    expect(r.status).toBe(400);
  });

  it.each([
    ['missing deleteAuctionTransactionDto', { addAuctionDtos: [] }],
    ['missing addAuctionDtos', { deleteAuctionTransactionDto: { auctionTransactionIds: ['x'] } }],
  ])('edit-auction rejects %s with 400', async (_label, body) => {
    const s = await getSeed();
    const r = await api.patch('/auction/edit-auction', body, { deviceId: s.deviceId });
    expect(r.status).toBe(400);
  });

  it('edit-auction without the deviceid header -> 400', async () => {
    const r = await api.patch(
      '/auction/edit-auction',
      {
        deleteAuctionTransactionDto: { auctionTransactionIds: ['00000000-0000-0000-0000-000000000000'] },
        addAuctionDtos: [],
      },
      { deviceId: null },
    );
    expect(r.status).toBe(400);
  });

  it.each([
    ['missing startDate', `endDate=${encodeURIComponent(`${today()} 23:59:59`)}`],
    ['missing endDate', `startDate=${encodeURIComponent(`${today()} 00:00:00`)}`],
  ])('list-auction-transaction rejects %s with 400', async (_label, qs) => {
    const r = await api.get(`/auction/list-auction-transaction?${qs}`);
    expect(r.status).toBe(400);
  });

  it('the listing accepts ISO datetimes with a Z suffix as well as space-separated ones', async () => {
    const r = await api.get(
      `/auction/list-auction-transaction?startDate=${encodeURIComponent(`${today()}T00:00:00.000Z`)}&endDate=${encodeURIComponent(`${today()}T23:59:59.999Z`)}`,
    );
    expect(r.status).toBe(200);
  });

  it('QUIRK: fractional chungi is rejected (int column) and owed_amount is untouched', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const r = await api.post(
      '/auction',
      [
        {
          kisanId: s.kisanId,
          itemId: s.itemId,
          auctionDate: `${today()}T12:00:00`,
          buyItems: [{ vyapariId: s.vyapariAId, rate: 10, quantity: 2, bag: 1, chungi: 0.5 }],
        },
      ],
      { deviceId: s.deviceId },
    );
    expect(r.status).toBe(500);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('startDate after endDate returns an empty result, not an error', async () => {
    const body = unwrap<any>(
      await api.get(
        `/auction/list-auction-transaction?startDate=${encodeURIComponent(`${today()} 23:59:59`)}&endDate=${encodeURIComponent(`${today()} 00:00:00`)}`,
      ),
    );
    expect(body ?? []).toHaveLength(0);
  });

  it('mark-transaction-validated counts freshly created unvalidated transactions', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);
    const d = today();

    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            auctionDate: `${d}T12:00:00`,
            buyItems: [
              { vyapariId: s.vyapariAId, rate: 9, quantity: 1, bag: 1, chungi: 0 },
              { vyapariId: s.vyapariAId, rate: 8, quantity: 1, bag: 1, chungi: 0 },
            ],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );
    const validated = unwrap<any>(
      await api.patch(
        `/auction/mark-transaction-validated?fromDate=${encodeURIComponent(`${d} 00:00:00`)}&toDate=${encodeURIComponent(`${d} 23:59:59`)}&vyapariId=${s.vyapariAId}`,
      ),
    );
    expect(Number(validated)).toBeGreaterThanOrEqual(2);
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(17, 2);

    const mine = (await listTxns(s.vyapariAId)).filter((t) => !before.includes(t.auctionTransactionId));
    await deleteTxns(mine.map((t) => t.auctionTransactionId));
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });
});

// Behaviour the frontends were built against on the old Spring server
// (mandi-server, app-runner-prod) — see db/auction_legacy_parity.sql.
describe('auction: old-server parity', () => {
  const validateQs = (d: string) =>
    `fromDate=${encodeURIComponent(`${d} 00:00:00`)}&toDate=${encodeURIComponent(`${d} 23:59:59`)}`;

  it('txn_no runs 1, 2, 3… per device per day, and an edit takes the next number', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);
    unwrap(
      await api.post('/auction', [
        {
          kisanId: s.kisanId,
          itemId: s.itemId,
          auctionDate: `${today()}T12:00:00`,
          buyItems: [
            { vyapariId: s.vyapariAId, rate: 5, quantity: 1, bags: 1 },
            { vyapariId: s.vyapariAId, rate: 6, quantity: 1, bags: 1 },
          ],
        },
      ]),
    );
    const mine = (await listTxns(s.vyapariAId))
      .filter((t) => !before.includes(t.auctionTransactionId))
      .sort((a, b) => a.txnNo - b.txnNo);
    expect(mine).toHaveLength(2);
    expect(Number.isInteger(mine[0].txnNo)).toBe(true);
    expect(mine[1].txnNo).toBe(mine[0].txnNo + 1);

    const deviceMax = Math.max(
      ...(unwrap<any[]>(
        await api.get(`/auction/list-auction-transaction?${listWindow()}&deviceId=${s.deviceId}`),
      ) ?? []).map((t) => t.txnNo ?? 0),
    );
    unwrap(
      await api.post('/auction/edit-auction-transaction', {
        auctionTransactionId: mine[0].auctionTransactionId,
        vyapariId: s.vyapariAId,
        rate: 7,
        quantity: 1,
        bag: 1,
        chungi: 0,
      }),
    );
    const edited = (await listTxns(s.vyapariAId)).find((t) => t.parentId === mine[0].auctionTransactionId);
    expect(edited.txnNo).toBe(deviceMax + 1);

    await deleteTxns([edited.auctionTransactionId, mine[1].auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('list rows carry the old field types: id numbers as numbers, deviceId as a string', async () => {
    const s = await getSeed();
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);
    await createAuction(s, { rate: 2, quantity: 1, chungi: 0 });
    const row = (await listTxns(s.vyapariAId)).find((t) => !before.includes(t.auctionTransactionId));
    expect(typeof row.kisanIdNo).toBe('number');
    expect(typeof row.vyapariIdNo).toBe('number');
    expect(row.deviceId).toBe(String(s.deviceId));
    // no per-bag weights sent: '' and [], never null
    expect(row.bagWiseQuantity).toBe('');
    expect(row.bagWiseQuantityArray).toEqual([]);
    await deleteTxns([row.auctionTransactionId]);
  });

  it('unfiltered list is ordered by kisan name, then item name', async () => {
    const rows = unwrap<any[]>(await api.get(`/auction/list-auction-transaction?${listWindow()}`)) ?? [];
    const keys = rows.map((r) => `${(r.kisanName ?? '').toLowerCase()}\u0000${(r.itemName ?? '').toLowerCase()}`);
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('edit-auction puts recreated auctions on the header device when the payload names none', async () => {
    const s = await getSeed();
    const baseline = await owed(s.vyapariAId);
    const before = (await listTxns(s.vyapariAId)).map((t) => t.auctionTransactionId);
    await createAuction(s, { rate: 11, quantity: 1, chungi: 0 });
    const original = (await listTxns(s.vyapariAId)).find((t) => !before.includes(t.auctionTransactionId));
    unwrap(
      await api.patch('/auction/edit-auction', {
        deleteAuctionTransactionDto: { auctionTransactionIds: [original.auctionTransactionId] },
        addAuctionDtos: [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            bag: null,
            deviceId: null,
            auctionDate: `${today()}T12:00:00`,
            buyItems: [{ vyapariId: s.vyapariAId, rate: 12, quantity: 1, bags: 1, chungi: 0 }],
          },
        ],
      }),
    );
    const recreated = (await listTxns(s.vyapariAId)).find((t) => !before.includes(t.auctionTransactionId));
    expect(recreated.deviceId).toBe(String(s.deviceId));
    expect((await owed(s.vyapariAId)) - baseline).toBeCloseTo(12, 2);
    await deleteTxns([recreated.auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseline, 2);
  });

  it('edit-auction-transaction on an unknown id -> 404', async () => {
    const s = await getSeed();
    const r = await api.post('/auction/edit-auction-transaction', {
      auctionTransactionId: '00000000-0000-0000-0000-000000000000',
      vyapariId: s.vyapariAId,
      rate: 1,
      quantity: 1,
      bag: 1,
      chungi: 0,
    });
    expect(r.status).toBe(404);
  });

  it('mark-transaction-validated bulk=true needs no vyapariId (auto_ledger parties)', async () => {
    const r = await api.patch(`/auction/mark-transaction-validated?${validateQs(today())}&bulk=true`);
    expect(r.status).toBe(200);
    expect(Number.isInteger(Number(r.body.responseBody))).toBe(true);
  });

  it('mark-transaction-validated with neither vyapariId nor bulk is a no-op', async () => {
    const r = await api.patch(`/auction/mark-transaction-validated?${validateQs(today())}`);
    expect(r.status).toBe(200);
    expect(Number(r.body.responseBody)).toBe(0);
  });
});
