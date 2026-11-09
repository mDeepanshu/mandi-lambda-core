import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { api, unwrap, today } from './helpers/client';
import { getSeed, Seed } from './helpers/seed';
import { owed } from './helpers/party';

// db/auction_write_v2.sql: the app names every auction and lot, so a write can
// be repeated (timeout + retry, double tap, two tabs) without duplicating rows
// or moving owed_amount twice; edits/deletes must target the current row.
// Dev/his formula: amount = (rate + chungi) * quantity.

const listWindow = () => {
  const d = today();
  return `startDate=${encodeURIComponent(`${d} 00:00:00`)}&endDate=${encodeURIComponent(`${d} 23:59:59`)}`;
};

async function listTxns(vyapariId: string): Promise<any[]> {
  const body = unwrap<any>(await api.get(`/auction/list-auction-transaction?${listWindow()}`));
  return (body ?? []).filter((t: any) => t.vyapariId === vyapariId);
}

const lot = (s: Seed, o: { id?: string; rate: number; quantity: number; vyapariId?: string }) => ({
  auctionTransactionId: o.id ?? randomUUID(),
  vyapariId: o.vyapariId ?? s.vyapariAId,
  rate: o.rate,
  quantity: o.quantity,
  bags: 1,
  chungi: 0,
});

const auctionBody = (s: Seed, auctionId: string, lots: any[], auctionDate = `${today()}T12:00:00`) => [
  { auctionId, kisanId: s.kisanId, itemId: s.itemId, auctionDate, buyItems: lots },
];

async function cleanup(ids: string[]) {
  if (ids.length) await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: ids });
}

describe('auction v2: create is safe to repeat', () => {
  it('posting the same auction twice saves it once and charges once', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const auctionId = randomUUID();
    const l = lot(s, { rate: 11, quantity: 3 }); // 33
    const body = auctionBody(s, auctionId, [l]);

    expect(unwrap(await api.post('/auction', body))).toEqual([true]);
    expect(unwrap(await api.post('/auction', body))).toEqual([true]); // the retry
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 33, 2);
    const mine = (await listTxns(s.vyapariAId)).filter((t) => t.auctionTransactionId === l.auctionTransactionId);
    expect(mine).toHaveLength(1);
    expect(mine[0].auctionId).toBe(auctionId);

    await cleanup([l.auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });

  it('a retry whose body was rebuilt (new auctionDate) still does not duplicate', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const auctionId = randomUUID();
    const l = lot(s, { rate: 7, quantity: 2 }); // 14
    unwrap(await api.post('/auction', auctionBody(s, auctionId, [l], `${today()}T12:00:00`)));
    unwrap(await api.post('/auction', auctionBody(s, auctionId, [l], `${today()}T12:00:05`)));
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 14, 2);
    await cleanup([l.auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });

  it('a retry carrying one saved lot and one new lot inserts only the new one', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const auctionId = randomUUID();
    const l1 = lot(s, { rate: 5, quantity: 2 }); // 10
    const l2 = lot(s, { rate: 4, quantity: 5 }); // 20
    unwrap(await api.post('/auction', auctionBody(s, auctionId, [l1])));
    unwrap(await api.post('/auction', auctionBody(s, auctionId, [l1, l2])));
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 30, 2);
    const ids = (await listTxns(s.vyapariAId)).filter((t) => t.auctionId === auctionId).map((t) => t.auctionTransactionId);
    expect(ids.sort()).toEqual([l1.auctionTransactionId, l2.auctionTransactionId].sort());
    await cleanup(ids);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });

  it('a late retry does not bring back a lot that was deleted', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const auctionId = randomUUID();
    const l = lot(s, { rate: 9, quantity: 1 });
    const body = auctionBody(s, auctionId, [l]);
    unwrap(await api.post('/auction', body));
    await cleanup([l.auctionTransactionId]);
    expect(unwrap(await api.post('/auction', body))).toEqual([true]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
    expect((await listTxns(s.vyapariAId)).some((t) => t.auctionTransactionId === l.auctionTransactionId)).toBe(false);
  });

  it('reusing a lot id with different values -> 409 AUCTION_ID_CONFLICT, owed unchanged', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const auctionId = randomUUID();
    const l = lot(s, { rate: 6, quantity: 1 });
    unwrap(await api.post('/auction', auctionBody(s, auctionId, [l])));
    const r = await api.post('/auction', auctionBody(s, auctionId, [{ ...l, rate: 60 }]));
    expect(r.status).toBe(409);
    expect((r.body.responseBody as any)?.code).toBe('AUCTION_ID_CONFLICT');
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 6, 2);
    await cleanup([l.auctionTransactionId]);
  });

  it('two auctions in one POST keep their own lots (ids fixed before insert)', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const a1 = randomUUID();
    const a2 = randomUUID();
    const l1 = lot(s, { rate: 2, quantity: 1 });
    const l2 = lot(s, { rate: 3, quantity: 1 });
    unwrap(
      await api.post('/auction', [...auctionBody(s, a1, [l1]), ...auctionBody(s, a2, [l2])]),
    );
    const rows = await listTxns(s.vyapariAId);
    expect(rows.find((t) => t.auctionTransactionId === l1.auctionTransactionId)?.auctionId).toBe(a1);
    expect(rows.find((t) => t.auctionTransactionId === l2.auctionTransactionId)?.auctionId).toBe(a2);
    await cleanup([l1.auctionTransactionId, l2.auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });
});

describe('auction v2: create validation', () => {
  it.each([
    ['kisanId that is a vyapari', (s: Seed) => ({ kisanId: s.vyapariAId })],
    ['unknown itemId', () => ({ itemId: 'NO_SUCH_ITEM' })],
    ['missing itemId', () => ({ itemId: undefined })],
    ['vyapariId that is a kisan', (s: Seed) => ({ buyItems: [{ ...lot(s, { rate: 1, quantity: 1 }), vyapariId: s.kisanId }] })],
    ['negative quantity', (s: Seed) => ({ buyItems: [lot(s, { rate: 1, quantity: -1 })] })],
    ['non-uuid auctionId', () => ({ auctionId: 'abc' })],
    ['non-uuid auctionTransactionId', (s: Seed) => ({ buyItems: [{ ...lot(s, { rate: 1, quantity: 1 }), auctionTransactionId: 'abc' }] })],
    ['the same lot id twice in one request', (s: Seed) => {
      const l = lot(s, { rate: 1, quantity: 1 });
      return { buyItems: [l, l] };
    }],
  ])('rejects %s with 400 and moves no money', async (_label, patch) => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const [a] = auctionBody(s, randomUUID(), [lot(s, { rate: 1, quantity: 1 })]);
    const r = await api.post('/auction', [{ ...a, ...patch(s) }]);
    expect(r.status).toBe(400);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });
});

describe('auction v2: edits and deletes must target the current row', () => {
  const edit = (s: Seed, id: string, rate: number, newId?: string) =>
    api.post('/auction/edit-auction-transaction', {
      auctionTransactionId: id,
      ...(newId ? { newAuctionTransactionId: newId } : {}),
      vyapariId: s.vyapariAId,
      rate,
      quantity: 2,
      bag: 1,
      chungi: 0,
    });

  it('a retried edit (same newAuctionTransactionId) moves money once', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const l = lot(s, { rate: 10, quantity: 2 }); // 20
    unwrap(await api.post('/auction', auctionBody(s, randomUUID(), [l])));
    const newId = randomUUID();
    expect((await edit(s, l.auctionTransactionId, 15, newId)).status).toBe(200); // 30
    expect((await edit(s, l.auctionTransactionId, 15, newId)).status).toBe(200); // retry: no-op
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 30, 2);
    await cleanup([newId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });

  it('editing a row that was already edited -> 409 AUCTION_TXN_STALE, no double subtract', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const l = lot(s, { rate: 10, quantity: 2 }); // 20
    unwrap(await api.post('/auction', auctionBody(s, randomUUID(), [l])));
    const first = await edit(s, l.auctionTransactionId, 12); // 24
    expect(first.status).toBe(200);
    const stale = await edit(s, l.auctionTransactionId, 14); // double tap / stale screen
    expect(stale.status).toBe(409);
    expect((stale.body.responseBody as any)?.code).toBe('AUCTION_TXN_STALE');
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 24, 2);
    const current = (first.body.responseBody as any).auctionTransactionId;
    await cleanup([current]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });

  it('deleting a row that was already edited -> 409, the live entry stays', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const l = lot(s, { rate: 10, quantity: 2 });
    unwrap(await api.post('/auction', auctionBody(s, randomUUID(), [l])));
    const newId = randomUUID();
    unwrap(await edit(s, l.auctionTransactionId, 11, newId)); // 22
    const r = await api.del('/auction/delete-auction-transaction', { auctionTransactionIds: [l.auctionTransactionId] });
    expect(r.status).toBe(409);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 22, 2);
    await cleanup([newId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });

  it('edit-auction with addAuctionDtos [] only deletes (the edit dialog removing every lot)', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const l = lot(s, { rate: 8, quantity: 2 }); // 16
    unwrap(await api.post('/auction', auctionBody(s, randomUUID(), [l])));
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 16, 2);
    const r = await api.patch('/auction/edit-auction', {
      deleteAuctionTransactionDto: { auctionTransactionIds: [l.auctionTransactionId] },
      addAuctionDtos: [],
    });
    expect(r.status).toBe(200);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
    expect((await listTxns(s.vyapariAId)).some((t) => t.auctionTransactionId === l.auctionTransactionId)).toBe(false);
  });

  it('edit-auction: a retry with the same new ids succeeds without change; without ids it is 409', async () => {
    const s = await getSeed();
    const base = await owed(s.vyapariAId);
    const l = lot(s, { rate: 10, quantity: 1 }); // 10
    unwrap(await api.post('/auction', auctionBody(s, randomUUID(), [l])));
    const replacement = lot(s, { rate: 25, quantity: 1 }); // 25
    const body = {
      deleteAuctionTransactionDto: { auctionTransactionIds: [l.auctionTransactionId] },
      addAuctionDtos: auctionBody(s, randomUUID(), [replacement]),
    };
    expect((await api.patch('/auction/edit-auction', body)).status).toBe(200);
    expect((await api.patch('/auction/edit-auction', body)).status).toBe(200); // retry
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 25, 2);

    // same stale ids, new lots without ids: refuse instead of adding on top
    const stale = await api.patch('/auction/edit-auction', {
      deleteAuctionTransactionDto: { auctionTransactionIds: [l.auctionTransactionId] },
      addAuctionDtos: [{ kisanId: s.kisanId, itemId: s.itemId, auctionDate: `${today()}T12:00:00`, buyItems: [{ vyapariId: s.vyapariAId, rate: 25, quantity: 1, bags: 1 }] }],
    });
    expect(stale.status).toBe(409);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base + 25, 2);

    await cleanup([replacement.auctionTransactionId]);
    expect(await owed(s.vyapariAId)).toBeCloseTo(base, 2);
  });
});
