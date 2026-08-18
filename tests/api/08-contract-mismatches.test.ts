import { describe, expect, it } from 'vitest';
import { api, today } from './helpers/client';
import { getSeed } from './helpers/seed';

// Pins known gaps between what the frontend calls and what the backend
// serves, plus endpoints whose database RPCs don't exist in ANY stage
// (verified against dev/his/hmb Postgres on 2026-07-18). When a gap is
// fixed, the corresponding test here should fail — update it deliberately.

describe('contract mismatches (documented, executable)', () => {
  it('mark-transaction-validated has no bulk mode: vyapariId is required', async () => {
    // frontend calls ...?fromDate=&toDate=&bulk=true — the backend has no
    // `bulk` param and rejects the request because vyapariId is missing
    const d = today();
    const r = await api.patch(
      `/auction/mark-transaction-validated?fromDate=${encodeURIComponent(`${d} 00:00:00`)}&toDate=${encodeURIComponent(`${d} 23:59:59`)}&bulk=true`,
    );
    expect(r.status).toBe(400);
  });

  it('device listDevices rejects status=DELETED (enum is REQUESTED/REJECTED/APPROVED)', async () => {
    const r = await api.get('/device/listDevices?status=DELETED');
    expect(r.status).toBe(400);
  });

  it('prefix-less POST /createItem is declared in serverless.ts but unrouted', async () => {
    // item router only matches POST /item/createItem
    const r = await api.post('/createItem', [{ name: 'TEST_SHOULD_NOT_EXIST' }]);
    expect(r.status).toBe(404);
  });

  it('the vasuli route misspelling is load-bearing: correct spelling 404s', async () => {
    const s = await getSeed();
    const correct = await api.post('/party/vasuliTransaction', [
      { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 1 },
    ]);
    expect(correct.status).toBe(404);
  });

  it('bare /vyapari-bill (without /bills prefix) is not routed', async () => {
    const s = await getSeed();
    const r = await api.get(`/vyapari-bill?vyapariId=${s.vyapariAId}&billDate=${today()}&index=0`);
    expect(r.status).toBe(404);
  });

  it('bill snapshot endpoints 500: save/get RPCs missing from every stage DB', async () => {
    // save_vyapari_bill / get_vyapari_bill_by_vyapari_id_and_date do not exist
    // in dev, his, or hmb — the /bills lambda cannot work anywhere
    const s = await getSeed();
    const save = await api.post('/bills/vyapari-bill', {
      vyapariId: s.vyapariAId,
      vyapariName: 'TEST_VYAPARI_AUTO_A',
      billDate: today(),
      vyapariBillItems: [],
    });
    expect(save.status).toBe(500);

    const get = await api.get(
      `/bills/vyapari-bill?vyapariId=${s.vyapariAId}&billDate=${today()}&index=0`,
    );
    expect(get.status).toBe(500);
  });

  it('ledger-list-all-vyapari 500s: list_vyapari_ledger_all RPC missing from every stage DB', async () => {
    const d = today();
    const r = await api.get(`/vyapari/ledger-list-all-vyapari?startDate=${d}&endDate=${d}`);
    expect(r.status).toBe(500);
  });

  it('ledger-list-all-vyapari still validates input first (400 beats the dead RPC)', async () => {
    const r = await api.get('/vyapari/ledger-list-all-vyapari');
    expect(r.status).toBe(400);
  });

  describe('dead /bills endpoints still validate input before hitting the missing RPCs', () => {
    it.each([
      ['GET vyapari-bill without vyapariId', `/bills/vyapari-bill?billDate=${today()}`],
      ['GET vyapari-bill without billDate', '/bills/vyapari-bill?vyapariId=X'],
      ['GET vyapari-bill with negative index', `/bills/vyapari-bill?vyapariId=X&billDate=${today()}&index=-1`],
      ['GET vyapari-bill with non-numeric index', `/bills/vyapari-bill?vyapariId=X&billDate=${today()}&index=abc`],
      ['GET vyapari-bill with fractional index', `/bills/vyapari-bill?vyapariId=X&billDate=${today()}&index=1.5`],
    ])('%s -> 400', async (_label, path) => {
      const r = await api.get(path);
      expect(r.status).toBe(400);
    });

    it.each([
      ['empty object', {}],
      ['array body', [{ vyapariId: 'X' }]],
      ['string body', 'bill'],
    ])('POST vyapari-bill with %s -> 400', async (_label, body) => {
      const r = await api.post('/bills/vyapari-bill', body);
      expect(r.status).toBe(400);
    });
  });
});
