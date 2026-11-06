import { describe, expect, it } from 'vitest';
import { api, unwrap } from './helpers/client';
import { getSeed, NAMES } from './helpers/seed';
import { owed } from './helpers/party';

// The contract is the old Spring server's (db/legacy_parity_api.sql): the list
// is PartyProjection (text idNo/partyType/commission), getPartyById and POST
// answer the Party entity (partyType KISAN/VYAPARI), PATCH answers a message
// with its result code inside an HTTP 200.

const getParty = async (partyId: string) =>
  unwrap<any>(await api.get(`/party/getPartyById?partyId=${encodeURIComponent(partyId)}`));

// find-or-create a fixed edge-case party; returns the stored row
async function ensureParty(partyId: string, body: Record<string, unknown>): Promise<any> {
  const existing = await api.get(`/party/getPartyById?partyId=${encodeURIComponent(partyId)}`);
  if (existing.status === 200) return existing.body.responseBody;
  const created = unwrap<any[]>(await api.post('/party', [{ partyId, ...body }]));
  return created[0];
}

const listed = async (partyId: string, qs = '') =>
  (unwrap<any[]>(await api.get(`/party/listAllParties${qs}`)) ?? []).find((p) => p.partyId === partyId);

describe('party: create, edit, read round-trip', () => {
  it('seeded TEST_ parties are readable by id with a numeric owedAmount', async () => {
    const s = await getSeed();
    for (const id of [s.vyapariAId, s.vyapariBId, s.kisanId]) {
      const p = await getParty(id);
      expect(p.partyId).toBe(id);
      expect(typeof p.owedAmount).toBe('number');
    }
    expect((await getParty(s.vyapariAId)).partyType).toBe('VYAPARI');
    expect((await getParty(s.kisanId)).partyType).toBe('KISAN');
  });

  it('listAllParties?partyType=VYAPARI contains the TEST_ vyapari and not the TEST_ kisan', async () => {
    await getSeed();
    const names = (unwrap<any[]>(await api.get('/party/listAllParties?partyType=VYAPARI'))).map((p) => p.name);
    expect(names).toContain(NAMES.vyapariA);
    expect(names).not.toContain(NAMES.kisan);
  });

  it('listAllParties?partyType=KISAN contains the TEST_ kisan and not the vyapari', async () => {
    await getSeed();
    const names = (unwrap<any[]>(await api.get('/party/listAllParties?partyType=KISAN'))).map((p) => p.name);
    expect(names).toContain(NAMES.kisan);
    expect(names).not.toContain(NAMES.vyapariA);
  });

  it('listAllParties without a filter includes both kisans and vyaparis — all of them, not 1000', async () => {
    await getSeed();
    const list = unwrap<any[]>(await api.get('/party/listAllParties'));
    const names = list.map((p) => p.name);
    expect(names).toContain(NAMES.kisan);
    expect(names).toContain(NAMES.vyapariA);
    const vy = unwrap<any[]>(await api.get('/party/listAllParties?partyType=VYAPARI')).length;
    const ki = unwrap<any[]>(await api.get('/party/listAllParties?partyType=KISAN')).length;
    expect(list.length).toBe(vy + ki);
  });

  it('list rows carry the PartyProjection types the frontends rely on', async () => {
    const s = await getSeed();
    const p = await listed(s.vyapariAId);
    expect(typeof p.idNo).toBe('string'); // .includes() search
    expect(p.partyType).toBe('1'); // Party-Master "Show Vyapari Only" compares with "1"
    expect(typeof p.owedAmount).toBe('number');
    expect(p).toHaveProperty('autoLedger');
    expect(p).toHaveProperty('lastVasuliDate');
  });

  it('the list is in case-insensitive partyId order (the old MySQL primary-key order)', async () => {
    const ids = unwrap<any[]>(await api.get('/party/listAllParties')).map((p) => String(p.partyId));
    const sorted = [...ids].sort((a, b) => {
      const x = a.toLowerCase(), y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
    expect(ids).toEqual(sorted);
  });

  it('PATCH /party edits name/contact/maxLoanDays without touching owed_amount', async () => {
    const s = await getSeed();
    const before = await owed(s.vyapariAId);

    const r = await api.patch('/party', { id: s.vyapariAId, name: NAMES.vyapariA, contact: '9990000001', maxLoanDays: '15' });
    expect(r.status).toBe(200);
    expect(r.body.responseCode).toBe('200');
    expect(r.body.responseBody).toBe('Party updated successfully');

    const p = await getParty(s.vyapariAId);
    expect(p.name).toBe(NAMES.vyapariA);
    expect(p.maxLoanDays).toBe(15);
    expect(await owed(s.vyapariAId)).toBeCloseTo(before, 2);
  });

  it('validatePartyCode finds the party by contact', async () => {
    const s = await getSeed();
    const rows = unwrap<any[]>(await api.get('/party/validatePartyCode?mobileNumber=9990000001'));
    expect(rows.some((p) => p.party_id === s.vyapariAId)).toBe(true);
  });
});

describe('party: POST /party body validation', () => {
  const base = { partyId: 'TEST_SHOULD_NOT_EXIST', name: 'TEST_X', contact: '9990001111', partyType: 'VYAPARI' };
  it.each([
    ['empty array', []],
    ['plain object instead of array', base],
    ['bare string body', 'not-a-party'],
    ['missing partyId', [{ ...base, partyId: undefined }]],
    ['missing partyType', [{ ...base, partyType: undefined }]],
    ['snake_case party_type only', [{ ...base, partyType: undefined, party_type: 'KISAN' }]],
    ['lowercase partyType (PartyType.valueOf is exact)', [{ ...base, partyType: 'vyapari' }]],
    ['numeric partyType', [{ ...base, partyType: 0 }]],
    ['owedAmount not numeric', [{ ...base, owedAmount: 'lots' }]],
    ['maxLoanDays not numeric', [{ ...base, maxLoanDays: 'ten' }]],
    ['one valid + one invalid entry rejects the whole batch', [base, { ...base, partyType: 'TRADER' }]],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await api.post('/party', body);
    expect(r.status).toBe(400);
  });
});

describe('party: PATCH /party validation', () => {
  it.each([
    ['non-numeric maxLoanDays', { id: 'TEST_VYAPARI_AUTO_A_ID', maxLoanDays: 'ten' }],
    ['array instead of object', [{ id: 'TEST_VYAPARI_AUTO_A_ID', name: 'X', contact: '1' }]],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await api.patch('/party', body);
    expect(r.status).toBe(400);
  });

  // the old server reported these inside an HTTP 200; the edit dialog shows responseBody
  it.each([
    ['missing id', { name: 'X', contact: '1' }, '400', 'Party ID is required'],
    ['unknown id', { id: 'TEST_NO_SUCH_PARTY_XYZ', name: 'ghost' }, '404', 'Party not found'],
    ['empty id', { id: '', name: 'X' }, '404', 'Party not found'],
  ])('%s -> HTTP 200 with responseCode %s', async (_label, body, code, message) => {
    const r = await api.patch('/party', body);
    expect(r.status).toBe(200);
    expect(r.body.responseCode).toBe(code);
    expect(r.body.responseBody).toBe(message);
  });
});

describe('party: query validation', () => {
  it.each([
    ['/party/getPartyById', 'getPartyById without partyId'],
    ['/party/getPartyById?partyId=', 'getPartyById with empty partyId'],
    ['/party/listAllParties?partyType=TRADER', 'listAllParties with unknown partyType'],
    ['/party/validatePartyCode', 'validatePartyCode without mobileNumber'],
    ['/party/validatePartyCode?mobileNumber=9990000001&idNo=abc', 'validatePartyCode with non-numeric idNo'],
  ])('GET %s -> 400 (%s)', async (path) => {
    const r = await api.get(path);
    expect(r.status).toBe(400);
  });

  it('listAllParties upper-cases partyType like the old server', async () => {
    const r = await api.get('/party/listAllParties?partyType=vyapari');
    expect(r.status).toBe(200);
    expect((r.body.responseBody as any[]).every((p) => p.partyType === '1')).toBe(true);
  });
});

describe('party: creation field round-trips', () => {
  it('camelCase create stores every field faithfully (text values as the frontends send them)', async () => {
    await ensureParty('TEST_PARTY_CAMEL_ID', {
      name: 'TEST_PARTY_CAMEL',
      contact: '9990002001',
      partyType: 'VYAPARI',
      owedAmount: '777.5',
      maxLoanDays: '21',
      ledgerOrder: '',
      partyCode: 'TCAM1',
      commission: '3',
    });
    const stored = await getParty('TEST_PARTY_CAMEL_ID');
    expect(stored).toMatchObject({ name: 'TEST_PARTY_CAMEL', contact: '9990002001', partyType: 'VYAPARI', maxLoanDays: 21, partyCode: 'TCAM1' });
    expect(Number(stored.owedAmount)).toBeCloseTo(777.5, 2);
    expect(Number(stored.commission)).toBe(3);
    expect(Number.isInteger(stored.idNo)).toBe(true);
    // the list shows commission as text with two decimals (PartyProjection)
    expect((await listed('TEST_PARTY_CAMEL_ID')).commission).toBe('3.00');
  });

  it('a party created without kisanType has none (the old server inserted the null)', async () => {
    const stored = await getParty('TEST_PARTY_CAMEL_ID');
    expect(stored.kisanType).toBeNull();
  });

  it('owedAmount defaults to 0 and partyCode to six random digits', async () => {
    const stored = await ensureParty('TEST_PARTY_KISAN2_ID', { name: 'TEST_PARTY_KISAN2', contact: '9990002002', partyType: 'KISAN', kisanType: 'B' });
    const p = await getParty('TEST_PARTY_KISAN2_ID');
    expect(p.kisanType).toBe('B');
    expect(p.partyType).toBe('KISAN');
    expect(Number(p.owedAmount)).toBe(0);
    expect(p.partyCode).toMatch(/^\d{6}$/);
    expect(stored).toBeDefined();
  });

  it('unknown extra fields are accepted and silently dropped', async () => {
    await ensureParty('TEST_PARTY_EXTRA_ID', { name: 'TEST_PARTY_EXTRA', contact: '9990002004', partyType: 'VYAPARI', totallyUnknownField: 'ignored' });
    const stored = await getParty('TEST_PARTY_EXTRA_ID');
    expect(stored.name).toBe('TEST_PARTY_EXTRA');
    expect(stored.totallyUnknownField).toBeUndefined();
  });

  it('names are stored verbatim (the old server did not trim)', async () => {
    await ensureParty('TEST_PARTY_TRIM_ID', { name: '  TEST_PARTY_TRIM  ', contact: '9990002006', partyType: 'VYAPARI' });
    expect((await getParty('TEST_PARTY_TRIM_ID')).name).toBe('  TEST_PARTY_TRIM  ');
  });

  it('a Devanagari (Hindi) name round-trips intact', async () => {
    await ensureParty('TEST_PARTY_HINDI_ID', { name: 'टेस्ट व्यापारी ऑटो', contact: '9990002007', partyType: 'VYAPARI' });
    expect((await getParty('TEST_PARTY_HINDI_ID')).name).toBe('टेस्ट व्यापारी ऑटो');
  });

  it('a 120-character name is stored without truncation', async () => {
    const longName = `TEST_PARTY_LONG_${'X'.repeat(104)}`;
    await ensureParty('TEST_PARTY_LONG_ID', { name: longName, contact: '9990002008', partyType: 'VYAPARI' });
    expect((await getParty('TEST_PARTY_LONG_ID')).name).toBe(longName);
  });

  it('contact with country code and separators is stored verbatim', async () => {
    await ensureParty('TEST_PARTY_CC_ID', { name: 'TEST_PARTY_CC', contact: '+91-99900-02009', partyType: 'VYAPARI' });
    expect((await getParty('TEST_PARTY_CC_ID')).contact).toBe('+91-99900-02009');
  });

  it('duplicate partyId is rejected without corrupting the existing row', async () => {
    const before = await getParty('TEST_PARTY_CAMEL_ID');
    const r = await api.post('/party', [
      { partyId: 'TEST_PARTY_CAMEL_ID', name: 'HIJACKED', contact: '0000000000', partyType: 'VYAPARI' },
    ]);
    expect(r.status).toBe(409);
    const after = await getParty('TEST_PARTY_CAMEL_ID');
    expect(after.name).toBe(before.name);
    expect(after.owedAmount).toBe(before.owedAmount);
  });

  it('POST answers 201 with the saved parties (the frontends check responseCode 201)', async () => {
    const r = await api.get('/party/getPartyById?partyId=TEST_PARTY_CREATED201_ID');
    if (r.status === 200) return; // created on an earlier run
    const created = await api.post('/party', [{ partyId: 'TEST_PARTY_CREATED201_ID', name: 'TEST_PARTY_CREATED201', contact: '9990002010', partyType: 'KISAN' }]);
    expect(created.body.responseCode).toBe('201');
    expect((created.body.responseBody as any[])[0].partyId).toBe('TEST_PARTY_CREATED201_ID');
  });
});

describe('party: PATCH behavior', () => {
  it('writes the fields the edit dialog sends; partyCode and lastNotifiedAmount are not editable', async () => {
    const before = await getParty('TEST_PARTY_CAMEL_ID');
    unwrap(
      await api.patch('/party', {
        id: 'TEST_PARTY_CAMEL_ID',
        name: 'TEST_PARTY_CAMEL',
        contact: '9990002001',
        maxLoanDays: 21,
        autoLedger: 'Y',
        commission: '4.5',
        partyCode: 'CHANGED',
        lastNotifiedAmount: 123.45,
      }),
    );
    const after = await getParty('TEST_PARTY_CAMEL_ID');
    expect(after.autoLedger).toBe('Y');
    expect(Number(after.commission)).toBe(4.5);
    expect(after.partyCode).toBe(before.partyCode);
    // restore the fixture the create test asserts on
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_CAMEL_ID', autoLedger: before.autoLedger, commission: before.commission }));
  });

  it('partyType can change through PATCH, given as the list sends it ("0"/"1")', async () => {
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_CAMEL_ID', partyType: '0' }));
    expect((await getParty('TEST_PARTY_CAMEL_ID')).partyType).toBe('KISAN');
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_CAMEL_ID', partyType: 'VYAPARI' }));
    expect((await getParty('TEST_PARTY_CAMEL_ID')).partyType).toBe('VYAPARI');
  });

  it('keys left out of the body keep their value (the old server mirror sends five)', async () => {
    const before = await getParty('TEST_PARTY_CAMEL_ID');
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_CAMEL_ID', name: 'TEST_PARTY_CAMEL', contact: '9990002001', maxLoanDays: 21 }));
    const after = await getParty('TEST_PARTY_CAMEL_ID');
    expect(after.autoLedger).toBe(before.autoLedger);
    expect(after.commission).toBe(before.commission);
  });

  it('moving a ledgerOrder shifts the parties in between by one', async () => {
    // two fixed parties at the far end of the order, so real rows are untouched
    await ensureParty('TEST_PARTY_ORD1_ID', { name: 'TEST_PARTY_ORD1', contact: '9990002011', partyType: 'VYAPARI' });
    await ensureParty('TEST_PARTY_ORD2_ID', { name: 'TEST_PARTY_ORD2', contact: '9990002012', partyType: 'VYAPARI' });
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_ORD1_ID', ledgerOrder: '' }));
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_ORD2_ID', ledgerOrder: '' }));
    const max = Math.max(0, ...unwrap<any[]>(await api.get('/party/listAllParties')).map((p) => p.ledgerOrder ?? 0));
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_ORD1_ID', ledgerOrder: max + 1 }));
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_ORD2_ID', ledgerOrder: max + 2 }));
    // ORD2 to ORD1's place: ORD1 shifts down one
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_ORD2_ID', ledgerOrder: max + 1 }));
    expect((await getParty('TEST_PARTY_ORD2_ID')).ledgerOrder).toBe(max + 1);
    expect((await getParty('TEST_PARTY_ORD1_ID')).ledgerOrder).toBe(max + 2);
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_ORD1_ID', ledgerOrder: '' }));
    unwrap(await api.patch('/party', { id: 'TEST_PARTY_ORD2_ID', ledgerOrder: '' }));
  });

  it('getPartyById with an unknown id -> 404', async () => {
    const r = await api.get('/party/getPartyById?partyId=TEST_NO_SUCH_PARTY_XYZ');
    expect(r.status).toBe(404);
  });
});

describe('party: validatePartyCode filters', () => {
  it('matching partyCode narrows to the party', async () => {
    const code = (await getParty('TEST_PARTY_CAMEL_ID')).partyCode;
    const rows = unwrap<any[]>(await api.get(`/party/validatePartyCode?mobileNumber=9990002001&partyCode=${code}`));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((p) => p.party_code === code)).toBe(true);
  });

  it('mismatching partyCode returns an empty list', async () => {
    const rows = unwrap<any[]>(await api.get('/party/validatePartyCode?mobileNumber=9990002001&partyCode=WRONG'));
    expect(rows).toHaveLength(0);
  });

  it('mismatching idNo returns an empty list', async () => {
    const rows = unwrap<any[]>(await api.get('/party/validatePartyCode?mobileNumber=9990002001&idNo=999999999'));
    expect(rows).toHaveLength(0);
  });

  it('unknown mobileNumber returns an empty list, not an error', async () => {
    const rows = unwrap<any[]>(await api.get('/party/validatePartyCode?mobileNumber=0000000009'));
    expect(rows).toHaveLength(0);
  });
});
