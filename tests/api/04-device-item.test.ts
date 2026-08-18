import { describe, expect, it } from 'vitest';
import { api, unwrap } from './helpers/client';
import { getSeed, NAMES } from './helpers/seed';

const EDGE_DEVICE = 'TEST_DEVICE_EDGE';

const listDevices = async (qs = '') =>
  unwrap<any[]>(await api.get(`/device/listDevices${qs}`)) ?? [];

// A dedicated device for status-transition tests so the seed device (which
// must stay APPROVED for auction headers) is never touched.
let edgeDeviceId: Promise<number> | undefined;
async function getEdgeDevice(): Promise<number> {
  return (edgeDeviceId ??= (async () => {
    const all = await listDevices('?status=REQUESTED,REJECTED,APPROVED');
    const hit = all.find((d) => d.name === EDGE_DEVICE);
    if (hit) return Number(hit.id);
    const created = unwrap<any>(await api.post('/device/register', { name: EDGE_DEVICE }));
    return Number((Array.isArray(created) ? created[0] : created).id);
  })());
}

describe('device: registration', () => {
  it.each([
    ['missing name', {}],
    ['empty name', { name: '' }],
    ['whitespace name', { name: '   ' }],
    ['array body', [{ name: 'X' }]],
  ])('register rejects %s with 400', async (_label, body) => {
    const r = await api.post('/device/register', body);
    expect(r.status).toBe(400);
  });

  it('a registered device starts in (or can be found via) the full status list', async () => {
    const id = await getEdgeDevice();
    const all = await listDevices('?status=REQUESTED,REJECTED,APPROVED');
    const mine = all.find((d) => Number(d.id) === id);
    expect(mine).toBeDefined();
    expect(['REQUESTED', 'REJECTED', 'APPROVED']).toContain(mine.status);
  });
});

describe('device: status transitions have no guard — every direction works', () => {
  // runs in order; each sets the status and verifies via the filtered listing
  it.each([
    ['REJECTED'],
    ['APPROVED'],
    ['REQUESTED'],
    ['APPROVED'],
    ['REJECTED'],
    ['REQUESTED'],
  ] as const)('set status -> %s and it appears under that filter', async (status) => {
    const id = await getEdgeDevice();
    unwrap(await api.put(`/device/${id}/status?status=${status}`));
    const filtered = await listDevices(`?status=${status}`);
    expect(filtered.some((d) => Number(d.id) === id)).toBe(true);
  });

  it('while REQUESTED it is absent from the APPROVED filter', async () => {
    const id = await getEdgeDevice();
    unwrap(await api.put(`/device/${id}/status?status=REQUESTED`));
    const approved = await listDevices('?status=APPROVED');
    expect(approved.some((d) => Number(d.id) === id)).toBe(false);
  });

  it('while REQUESTED it is absent from the REJECTED filter', async () => {
    const id = await getEdgeDevice();
    const rejected = await listDevices('?status=REJECTED');
    expect(rejected.some((d) => Number(d.id) === id)).toBe(false);
  });

  it('comma-combined filters include it when its status is in the set', async () => {
    const id = await getEdgeDevice();
    const combo = await listDevices('?status=REQUESTED,APPROVED');
    expect(combo.some((d) => Number(d.id) === id)).toBe(true);
  });

  it('comma-combined filters exclude it when its status is not in the set', async () => {
    const id = await getEdgeDevice();
    const combo = await listDevices('?status=REJECTED,APPROVED');
    expect(combo.some((d) => Number(d.id) === id)).toBe(false);
  });

  it('no status filter defaults to all three statuses', async () => {
    const id = await getEdgeDevice();
    const all = await listDevices();
    expect(all.some((d) => Number(d.id) === id)).toBe(true);
  });
});

describe('device: listDevices and status update validation', () => {
  it.each([
    ['empty status', '?status='],
    ['lowercase status', '?status=approved'],
    ['valid + invalid combo', '?status=APPROVED,BOGUS'],
    ['empty segment in combo', '?status=APPROVED,,REQUESTED'],
  ])('listDevices rejects %s with 400', async (_label, qs) => {
    const r = await api.get(`/device/listDevices${qs}`);
    expect(r.status).toBe(400);
  });

  it('PUT with a non-numeric id in the path -> 404 (route regex requires digits)', async () => {
    const r = await api.put('/device/abc/status?status=APPROVED');
    expect(r.status).toBe(404);
  });

  it('PUT without status -> 400', async () => {
    const id = await getEdgeDevice();
    const r = await api.put(`/device/${id}/status`);
    expect(r.status).toBe(400);
  });

  it('PUT with an unknown enum value -> 400', async () => {
    const id = await getEdgeDevice();
    const r = await api.put(`/device/${id}/status?status=BANANA`);
    expect(r.status).toBe(400);
  });

  it('PUT with lowercase status -> 400 (enum is case-sensitive)', async () => {
    const id = await getEdgeDevice();
    const r = await api.put(`/device/${id}/status?status=approved`);
    expect(r.status).toBe(400);
  });

  it('device rows expose id, name, and a valid status', async () => {
    const all = await listDevices();
    expect(all.length).toBeGreaterThanOrEqual(1);
    for (const d of all.slice(0, 5)) {
      expect(Number.isInteger(Number(d.id))).toBe(true);
      expect(typeof d.name).toBe('string');
      expect(['REQUESTED', 'REJECTED', 'APPROVED']).toContain(d.status);
    }
  });
});

describe('item: createItem validation', () => {
  it.each([
    ['empty array', []],
    ['plain object', { name: 'X' }],
    ['missing name', [{ itemId: 'X1' }]],
    ['empty name', [{ name: '' }]],
    ['whitespace name', [{ name: '  ' }]],
    ['empty itemId (must be omitted or non-empty)', [{ itemId: '', name: 'X' }]],
    ['one valid + one invalid entry', [{ name: 'OK' }, { name: '' }]],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await api.post('/item/createItem', body);
    expect(r.status).toBe(400);
  });
});

describe('item: create and list behavior', () => {
  it('find-or-create a fixed edge item and see it in listItems', async () => {
    const items = unwrap<any[]>(await api.get('/item/listItems'));
    let mine = items.find((i) => i.name === 'TEST_ITEM_EDGE');
    if (!mine) {
      const r = await api.post('/item/createItem', [{ itemId: 'TEST_ITEM_EDGE_ID', name: 'TEST_ITEM_EDGE' }]);
      expect(r.status).toBe(201);
      expect(r.body.responseMessage).toBe('Saved Successfully');
    }
    const after = unwrap<any[]>(await api.get('/item/listItems'));
    mine = after.find((i) => i.name === 'TEST_ITEM_EDGE');
    expect(mine).toBeDefined();
    expect(mine.itemId).toBe('TEST_ITEM_EDGE_ID');
  });

  it('duplicate itemId is rejected and does not duplicate the row', async () => {
    const r = await api.post('/item/createItem', [{ itemId: 'TEST_ITEM_EDGE_ID', name: 'TEST_ITEM_EDGE_DUP' }]);
    expect(r.status).toBeGreaterThanOrEqual(400);
    const items = unwrap<any[]>(await api.get('/item/listItems'));
    expect(items.filter((i) => i.itemId === 'TEST_ITEM_EDGE_ID')).toHaveLength(1);
  });

  it('listItems rows are {itemId, name} string pairs', async () => {
    const items = unwrap<any[]>(await api.get('/item/listItems'));
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const i of items.slice(0, 5)) {
      expect(typeof i.itemId).toBe('string');
      expect(typeof i.name).toBe('string');
    }
  });

  it('the seeded TEST item is present', async () => {
    await getSeed();
    const items = unwrap<any[]>(await api.get('/item/listItems'));
    expect(items.some((i) => i.name === NAMES.item)).toBe(true);
  });

  it('prefix-less GET /listItems serves the same data as /item/listItems', async () => {
    const root = unwrap<any[]>(await api.get('/listItems'));
    const scoped = unwrap<any[]>(await api.get('/item/listItems'));
    expect(root.length).toBe(scoped.length);
  });

  it('a batch create lands every item in the list', async () => {
    const items = unwrap<any[]>(await api.get('/item/listItems'));
    const missing = [
      { itemId: 'TEST_ITEM_BATCH1_ID', name: 'TEST_ITEM_BATCH1' },
      { itemId: 'TEST_ITEM_BATCH2_ID', name: 'TEST_ITEM_BATCH2' },
    ].filter((want) => !items.some((i) => i.itemId === want.itemId));
    if (missing.length) {
      const r = await api.post('/item/createItem', missing);
      expect(r.status).toBe(201);
    }
    const after = unwrap<any[]>(await api.get('/item/listItems'));
    expect(after.some((i) => i.itemId === 'TEST_ITEM_BATCH1_ID')).toBe(true);
    expect(after.some((i) => i.itemId === 'TEST_ITEM_BATCH2_ID')).toBe(true);
  });

  it('an item name with Devanagari script round-trips intact', async () => {
    const items = unwrap<any[]>(await api.get('/item/listItems'));
    if (!items.some((i) => i.itemId === 'TEST_ITEM_HINDI_ID')) {
      unwrap(await api.post('/item/createItem', [{ itemId: 'TEST_ITEM_HINDI_ID', name: 'टेस्ट आइटम' }]));
    }
    const after = unwrap<any[]>(await api.get('/item/listItems'));
    const mine = after.find((i) => i.itemId === 'TEST_ITEM_HINDI_ID');
    expect(mine?.name).toBe('टेस्ट आइटम');
  });
});

describe('device: idempotent status set', () => {
  it('setting the current status again succeeds and keeps the device listed once', async () => {
    const id = await getEdgeDevice();
    unwrap(await api.put(`/device/${id}/status?status=REQUESTED`));
    unwrap(await api.put(`/device/${id}/status?status=REQUESTED`));
    const filtered = await listDevices('?status=REQUESTED');
    expect(filtered.filter((d) => Number(d.id) === id)).toHaveLength(1);
  });
});
