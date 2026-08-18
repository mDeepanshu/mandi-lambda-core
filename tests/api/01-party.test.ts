import { describe, expect, it } from 'vitest';
import { api, unwrap } from './helpers/client';
import { getSeed, NAMES } from './helpers/seed';
import { owed } from './helpers/party';

const getParty = async (partyId: string) =>
  unwrap<any>(await api.get(`/party/getPartyById?partyId=${encodeURIComponent(partyId)}`));

// find-or-create a fixed edge-case party; returns the stored row
async function ensureParty(partyId: string, body: Record<string, unknown>): Promise<any> {
  const existing = await api.get(`/party/getPartyById?partyId=${encodeURIComponent(partyId)}`);
  if (existing.status === 200) return existing.body.responseBody;
  const created = unwrap<any[]>(await api.post('/party', [{ partyId, ...body }]));
  return created[0];
}

describe('party: create, edit, read round-trip', () => {
  it('seeded TEST_ parties are readable by id with numeric owed_amount', async () => {
    const s = await getSeed();
    for (const id of [s.vyapariAId, s.vyapariBId, s.kisanId]) {
      const p = await getParty(id);
      expect(p.party_id).toBe(id);
      expect(Number.isFinite(Number(p.owed_amount ?? 0))).toBe(true);
    }
  });

  it('listAllParties?partyType=VYAPARI contains the TEST_ vyapari and not the TEST_ kisan', async () => {
    await getSeed();
    const list = unwrap<any[]>(await api.get('/party/listAllParties?partyType=VYAPARI'));
    const names = list.map((p) => p.name ?? p.partyName ?? p.party_name);
    expect(names).toContain(NAMES.vyapariA);
    expect(names).not.toContain(NAMES.kisan);
  });

  it('listAllParties?partyType=KISAN contains the TEST_ kisan and not the vyapari', async () => {
    await getSeed();
    const list = unwrap<any[]>(await api.get('/party/listAllParties?partyType=KISAN'));
    const names = list.map((p) => p.name ?? p.partyName ?? p.party_name);
    expect(names).toContain(NAMES.kisan);
    expect(names).not.toContain(NAMES.vyapariA);
  });

  it('listAllParties without a filter includes both kisans and vyaparis', async () => {
    await getSeed();
    const list = unwrap<any[]>(await api.get('/party/listAllParties'));
    const names = list.map((p) => p.name ?? p.partyName ?? p.party_name);
    expect(names).toContain(NAMES.kisan);
    expect(names).toContain(NAMES.vyapariA);
  });

  it('PATCH /party edits name/contact/maxLoanDays without touching owed_amount', async () => {
    const s = await getSeed();
    const before = await owed(s.vyapariAId);

    const updated = unwrap<any>(
      await api.patch('/party', {
        id: s.vyapariAId,
        name: NAMES.vyapariA,
        contact: '9990000001',
        maxLoanDays: 15,
      }),
    );
    expect(updated.name).toBe(NAMES.vyapariA);
    expect(updated.max_loan_days).toBe(15);
    expect(Number(updated.owed_amount ?? 0)).toBeCloseTo(before, 2);
  });

  it('validatePartyCode finds the party by contact', async () => {
    const s = await getSeed();
    const rows = unwrap<any[]>(await api.get('/party/validatePartyCode?mobileNumber=9990000001'));
    expect(rows.some((p) => p.party_id === s.vyapariAId)).toBe(true);
  });
});

describe('party: POST /party body validation', () => {
  it.each([
    ['empty array', []],
    ['plain object instead of array', { name: 'X', contact: '1', partyType: 'VYAPARI' }],
    ['bare string body', 'not-a-party'],
    ['missing name', [{ contact: '9990001111', partyType: 'VYAPARI' }]],
    ['empty name', [{ name: '', contact: '9990001111', partyType: 'VYAPARI' }]],
    ['whitespace-only name', [{ name: '   ', contact: '9990001111', partyType: 'VYAPARI' }]],
    ['null name', [{ name: null, contact: '9990001111', partyType: 'VYAPARI' }]],
    ['missing contact', [{ name: 'TEST_X', partyType: 'VYAPARI' }]],
    ['numeric contact (must be string)', [{ name: 'TEST_X', contact: 9990001111, partyType: 'VYAPARI' }]],
    ['missing party_type and partyType', [{ name: 'TEST_X', contact: '9990001111' }]],
    ['numeric partyType (must be string)', [{ name: 'TEST_X', contact: '9990001111', partyType: 0 }]],
    ['owedAmount not numeric', [{ name: 'TEST_X', contact: '9990001111', partyType: 'VYAPARI', owedAmount: 'lots' }]],
    [
      'one valid + one invalid entry rejects the whole batch',
      [
        { name: 'TEST_OK', contact: '9990001111', partyType: 'VYAPARI' },
        { contact: '9990001111', partyType: 'VYAPARI' },
      ],
    ],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await api.post('/party', body);
    expect(r.status).toBe(400);
  });
});

describe('party: PATCH /party body validation', () => {
  it.each([
    ['missing id', { name: 'X', contact: '1' }],
    ['empty id', { id: '', name: 'X', contact: '1' }],
    ['missing name', { id: 'TEST_VYAPARI_AUTO_A_ID', contact: '1' }],
    ['missing contact', { id: 'TEST_VYAPARI_AUTO_A_ID', name: 'X' }],
    ['non-numeric maxLoanDays', { id: 'TEST_VYAPARI_AUTO_A_ID', name: 'X', contact: '1', maxLoanDays: 'ten' }],
    ['array instead of object', [{ id: 'TEST_VYAPARI_AUTO_A_ID', name: 'X', contact: '1' }]],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await api.patch('/party', body);
    expect(r.status).toBe(400);
  });
});

describe('party: query validation', () => {
  it.each([
    ['/party/getPartyById', 'getPartyById without partyId'],
    ['/party/getPartyById?partyId=', 'getPartyById with empty partyId'],
    ['/party/listAllParties?partyType=TRADER', 'listAllParties with unknown partyType'],
    ['/party/listAllParties?partyType=vyapari', 'listAllParties with lowercase partyType'],
    ['/party/validatePartyCode', 'validatePartyCode without mobileNumber'],
    ['/party/validatePartyCode?mobileNumber=9990000001&idNo=abc', 'validatePartyCode with non-numeric idNo'],
  ])('GET %s -> 400 (%s)', async (path) => {
    const r = await api.get(path);
    expect(r.status).toBe(400);
  });
});

describe('party: creation field round-trips and quirks', () => {
  it('camelCase create stores every field faithfully', async () => {
    const p = await ensureParty('TEST_PARTY_CAMEL_ID', {
      name: 'TEST_PARTY_CAMEL',
      contact: '9990002001',
      partyType: 'VYAPARI',
      owedAmount: 777.5,
      maxLoanDays: 21,
      ledgerOrder: 42,
      partyCode: 'TCAM1',
    });
    const stored = await getParty('TEST_PARTY_CAMEL_ID');
    expect(stored.name).toBe('TEST_PARTY_CAMEL');
    expect(stored.contact).toBe('9990002001');
    expect(stored.party_type).toBe(1);
    expect(Number(stored.owed_amount)).toBeCloseTo(777.5, 2);
    expect(stored.max_loan_days).toBe(21);
    expect(stored.ledger_order).toBe(42);
    expect(stored.party_code).toBe('TCAM1');
    expect(p).toBeDefined();
  });

  it('created party gets DB defaults: kisan_type A and an auto id_no', async () => {
    const stored = await getParty('TEST_PARTY_CAMEL_ID');
    expect(stored.kisan_type).toBe('A');
    expect(Number.isInteger(Number(stored.id_no))).toBe(true);
  });

  it('partyType KISAN maps to party_type 0', async () => {
    await ensureParty('TEST_PARTY_KIS_ID', {
      name: 'TEST_PARTY_KIS',
      contact: '9990002002',
      partyType: 'KISAN',
    });
    const stored = await getParty('TEST_PARTY_KIS_ID');
    expect(stored.party_type).toBe(0);
  });

  it('QUIRK: snake_case party_type alone always creates a VYAPARI (service reads only camelCase)', async () => {
    // createParty maps `partyType === 'KISAN' ? 0 : 1`; a snake_case-only
    // payload leaves partyType undefined, so even party_type=KISAN becomes 1
    await ensureParty('TEST_PARTY_SNAKE_ID', {
      name: 'TEST_PARTY_SNAKE',
      contact: '9990002003',
      party_type: 'KISAN',
    });
    const stored = await getParty('TEST_PARTY_SNAKE_ID');
    expect(stored.party_type).toBe(1);
  });

  it('unknown extra fields are accepted and silently dropped', async () => {
    await ensureParty('TEST_PARTY_EXTRA_ID', {
      name: 'TEST_PARTY_EXTRA',
      contact: '9990002004',
      partyType: 'VYAPARI',
      totallyUnknownField: 'ignored',
    });
    const stored = await getParty('TEST_PARTY_EXTRA_ID');
    expect(stored.name).toBe('TEST_PARTY_EXTRA');
    expect(stored.totallyUnknownField).toBeUndefined();
  });

  it('owedAmount accepts a numeric string and coerces it', async () => {
    await ensureParty('TEST_PARTY_STROWED_ID', {
      name: 'TEST_PARTY_STROWED',
      contact: '9990002005',
      partyType: 'VYAPARI',
      owedAmount: '55.25',
    });
    const stored = await getParty('TEST_PARTY_STROWED_ID');
    expect(Number(stored.owed_amount)).toBeCloseTo(55.25, 2);
  });

  it('leading/trailing whitespace in the name is trimmed before storage', async () => {
    await ensureParty('TEST_PARTY_TRIM_ID', {
      name: '  TEST_PARTY_TRIM  ',
      contact: '9990002006',
      partyType: 'VYAPARI',
    });
    const stored = await getParty('TEST_PARTY_TRIM_ID');
    expect(stored.name).toBe('TEST_PARTY_TRIM');
  });

  it('a Devanagari (Hindi) name round-trips intact', async () => {
    await ensureParty('TEST_PARTY_HINDI_ID', {
      name: 'टेस्ट व्यापारी ऑटो',
      contact: '9990002007',
      partyType: 'VYAPARI',
    });
    const stored = await getParty('TEST_PARTY_HINDI_ID');
    expect(stored.name).toBe('टेस्ट व्यापारी ऑटो');
  });

  it('a 120-character name is stored without truncation', async () => {
    const longName = `TEST_PARTY_LONG_${'X'.repeat(104)}`;
    await ensureParty('TEST_PARTY_LONG_ID', {
      name: longName,
      contact: '9990002008',
      partyType: 'VYAPARI',
    });
    const stored = await getParty('TEST_PARTY_LONG_ID');
    expect(stored.name).toBe(longName);
  });

  it('contact with country code and separators is stored verbatim', async () => {
    await ensureParty('TEST_PARTY_CC_ID', {
      name: 'TEST_PARTY_CC',
      contact: '+91-99900-02009',
      partyType: 'VYAPARI',
    });
    const stored = await getParty('TEST_PARTY_CC_ID');
    expect(stored.contact).toBe('+91-99900-02009');
  });

  it('duplicate party_id is rejected without corrupting the existing row', async () => {
    const before = await getParty('TEST_PARTY_CAMEL_ID');
    const r = await api.post('/party', [
      { partyId: 'TEST_PARTY_CAMEL_ID', name: 'HIJACKED', contact: '0000000000', partyType: 'VYAPARI' },
    ]);
    expect(r.status).toBeGreaterThanOrEqual(400);
    const after = await getParty('TEST_PARTY_CAMEL_ID');
    expect(after.name).toBe(before.name);
    expect(after.contact).toBe(before.contact);
  });
});

describe('party: PATCH behavior', () => {
  it('updates ledgerOrder, lastNotifiedAmount, and partyCode', async () => {
    const updated = unwrap<any>(
      await api.patch('/party', {
        id: 'TEST_PARTY_CAMEL_ID',
        name: 'TEST_PARTY_CAMEL',
        contact: '9990002001',
        maxLoanDays: 21,
        ledgerOrder: 42,
        lastNotifiedAmount: 123.45,
        partyCode: 'TCAM1',
      }),
    );
    expect(updated.ledger_order).toBe(42);
    expect(Number(updated.last_notified_amount)).toBeCloseTo(123.45, 2);
    expect(updated.party_code).toBe('TCAM1');
  });

  it('cannot change party_type through PATCH (field is not in the update map)', async () => {
    const before = await getParty('TEST_PARTY_CAMEL_ID');
    unwrap(
      await api.patch('/party', {
        id: 'TEST_PARTY_CAMEL_ID',
        name: 'TEST_PARTY_CAMEL',
        contact: '9990002001',
        party_type: 0,
        partyType: 'KISAN',
      }),
    );
    const after = await getParty('TEST_PARTY_CAMEL_ID');
    expect(after.party_type).toBe(before.party_type);
  });

  it('PATCH with an unknown id fails without a 200', async () => {
    const r = await api.patch('/party', {
      id: 'TEST_NO_SUCH_PARTY_XYZ',
      name: 'ghost',
      contact: '0000000000',
    });
    expect([400, 404, 500]).toContain(r.status);
  });

  it('getPartyById with an unknown id fails without a 200', async () => {
    const r = await api.get('/party/getPartyById?partyId=TEST_NO_SUCH_PARTY_XYZ');
    expect([404, 500]).toContain(r.status);
  });
});

describe('party: validatePartyCode filters', () => {
  it('matching partyCode narrows to the party', async () => {
    const rows = unwrap<any[]>(
      await api.get('/party/validatePartyCode?mobileNumber=9990002001&partyCode=TCAM1'),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((p) => p.party_code === 'TCAM1')).toBe(true);
  });

  it('mismatching partyCode returns an empty list', async () => {
    const rows = unwrap<any[]>(
      await api.get('/party/validatePartyCode?mobileNumber=9990002001&partyCode=WRONG'),
    );
    expect(rows).toHaveLength(0);
  });

  it('mismatching idNo returns an empty list', async () => {
    const rows = unwrap<any[]>(
      await api.get('/party/validatePartyCode?mobileNumber=9990002001&idNo=999999999'),
    );
    expect(rows).toHaveLength(0);
  });

  it('unknown mobileNumber returns an empty list, not an error', async () => {
    const rows = unwrap<any[]>(await api.get('/party/validatePartyCode?mobileNumber=0000000009'));
    expect(rows).toHaveLength(0);
  });
});
