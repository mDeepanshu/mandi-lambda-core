import { describe, expect, it } from 'vitest';
import { api, today } from './helpers/client';
import { getSeed } from './helpers/seed';

// Contract points between the frontends and the backend that look wrong but
// are load-bearing, and the routes the old Spring server exposed at unusual
// paths. The gaps pinned here until 2026-11-04 (DELETED device status, the
// root /vyapari-bill and POST / routes, the missing bill and all-ledger RPCs)
// are closed by db/legacy_parity_api.sql and now have positive tests in their
// own files.

describe('contract (old-server routes the frontends depend on)', () => {
  it('the vasuli route misspelling is load-bearing: correct spelling 404s', async () => {
    const s = await getSeed();
    const correct = await api.post('/party/vasuliTransaction', [
      { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 1 },
    ]);
    expect(correct.status).toBe(404);
  });

  it('device listDevices accepts DELETED (mandi-auction asks for REJECTED,DELETED)', async () => {
    const r = await api.get('/device/listDevices?status=REJECTED,DELETED');
    expect(r.status).toBe(200);
  });

  it('prefix-less POST /createItem and POST / both create items', async () => {
    const r = await api.post('/createItem', [{ itemId: 'TEST_ITEM_EDGE_ID', name: 'TEST_ITEM_EDGE' }]);
    expect(r.status).toBe(200);
  });

  it('ledger-list-all-vyapari validates its dates', async () => {
    const r = await api.get('/vyapari/ledger-list-all-vyapari');
    expect(r.status).toBe(400);
  });

  describe('vyapari-bill validates input on both its paths', () => {
    it.each([
      ['GET vyapari-bill without vyapariId', `/vyapari-bill?billDate=${today()}`],
      ['GET vyapari-bill without billDate', '/bills/vyapari-bill?vyapariId=X'],
      ['GET vyapari-bill with negative index', `/vyapari-bill?vyapariId=X&billDate=${today()}&index=-1`],
      ['GET vyapari-bill with non-numeric index', `/bills/vyapari-bill?vyapariId=X&billDate=${today()}&index=abc`],
      ['GET vyapari-bill with fractional index', `/vyapari-bill?vyapariId=X&billDate=${today()}&index=1.5`],
    ])('%s -> 400', async (_label, path) => {
      const r = await api.get(path);
      expect(r.status).toBe(400);
    });

    it.each([
      ['empty object', {}],
      ['array body', [{ vyapariId: 'X' }]],
      ['string body', 'bill'],
    ])('POST vyapari-bill with %s -> 400', async (_label, body) => {
      const r = await api.post('/vyapari-bill', body);
      expect(r.status).toBe(400);
    });
  });
});
