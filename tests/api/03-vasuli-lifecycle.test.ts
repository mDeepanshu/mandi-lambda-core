import { describe, expect, it } from 'vitest';
import { api, unwrap, today } from './helpers/client';
import { getSeed } from './helpers/seed';
import { owed } from './helpers/party';

// Dev/his DB invariants (db/vasuli_owed_amount.sql):
//   insert:              owed_amount -= amount
//   edit (same vyapari): owed_amount += old.amount - new.amount
//   edit (reassign A->B): A.owed_amount += old.amount, B.owed_amount -= new.amount

// The old server refuses a second same-day vasuli for a vyapari unless
// confirmDuplicate=true (see the duplicate test), and these tests post many —
// so inserts confirm by default, like mandi-auction always does.
const postVasuli = (rows: unknown, qs = '?confirmDuplicate=true') => api.post(`/party/vasuliTrasaction${qs}`, rows);

async function zeroVasuli(id: string, vyapariId: string, remark: string) {
  unwrap(
    await api.put('/vyapari/edit-vasuli', {
      id,
      amount: 0,
      vyapariId,
      date: `${today()}T12:00:00`,
      remark,
    }),
  );
}

describe('vasuli lifecycle: owed_amount deltas', () => {
  it('insert -> edit amount -> reassign to another vyapari', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const baseB = await owed(s.vyapariBId);
    const stamp = Date.now(); // unique remark so re-runs never look like duplicates

    // insert 500 against A
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 500, remark: `TEST_VASULI_${stamp}` },
      ]),
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    const vasuliId = String(rows[0].id);
    expect(Number(rows[0].amount)).toBeCloseTo(500, 2);
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-500, 2);

    // edit amount 500 -> 300 (same vyapari): owed += 200
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id: vasuliId,
        amount: 300,
        vyapariId: s.vyapariAId,
        date: `${today()}T12:00:00`,
        remark: `TEST_VASULI_${stamp}_EDIT`,
      }),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-300, 2);

    // reassign A -> B keeping amount 300: A back to baseline, B -= 300
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id: vasuliId,
        amount: 300,
        vyapariId: s.vyapariBId,
        date: `${today()}T12:00:00`,
        remark: `TEST_VASULI_${stamp}_REASSIGN`,
      }),
    );
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
    expect((await owed(s.vyapariBId)) - baseB).toBeCloseTo(-300, 2);

    // neutralize B's drift so repeated runs don't walk owed_amount downward
    await zeroVasuli(vasuliId, s.vyapariBId, `TEST_VASULI_${stamp}_ZEROED`);
    expect(await owed(s.vyapariBId)).toBeCloseTo(baseB, 2);
  });

  it('duplicate warning: a second same-day vasuli waits for confirmDuplicate=true', async () => {
    const s = await getSeed();
    const stamp = Date.now();
    const payload = [
      { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 250, remark: `TEST_DUP_${stamp}` },
    ];
    const ids: string[] = [];

    const first = await postVasuli(payload);
    expect(first.status).toBe(200);
    ids.push(String((first.body.responseBody as any[])[0].id));
    const afterFirst = await owed(s.vyapariAId);

    // unconfirmed: the old server's warning, as HTTP 200 + responseCode "400"
    // with a text body — the ledger screen's "continue?" dialog needs exactly that
    const second = await postVasuli(payload, '?confirmDuplicate=false');
    expect(second.status).toBe(200);
    expect(second.body.responseCode).toBe('400');
    expect(second.body.responseBody).toMatch(/^TEST_VYAPARI_AUTO_A already has \d+ vasulis, are you sure you want to continue\?$/);
    expect(await owed(s.vyapariAId)).toBeCloseTo(afterFirst, 2);

    // confirmed: saved, strictly "200" (mandi-auction compares with ===)
    const third = await postVasuli(payload);
    expect(third.body.responseCode).toBe('200');
    ids.push(String((third.body.responseBody as any[])[0].id));
    expect((await owed(s.vyapariAId)) - afterFirst).toBeCloseTo(-250, 2);

    // no flag at all = confirmed: only the old server's mirror omits it, and it
    // posts vasulis the old server already confirmed
    const mirrored = await api.post('/party/vasuliTrasaction', payload);
    expect(mirrored.body.responseCode).toBe('200');
    ids.push(String((mirrored.body.responseBody as any[])[0].id));

    // today's list has both, and totalVasuli adds whole rupees of every row
    const d = today();
    const listBody = unwrap<any>(await api.get(`/vyapari/vasuli-list?startDate=${d}&endDate=${d}`));
    const list: any[] = listBody?.vasuliList ?? [];
    expect(list.filter((v: any) => ids.includes(String(v.id)))).toHaveLength(3);
    const truncSum = list.reduce((sum, v) => sum + Math.trunc(Number(v.amount ?? 0)), 0);
    expect(Number(listBody.totalVasuli)).toBe(truncSum);

    for (const id of ids) {
      await zeroVasuli(id, s.vyapariAId, `TEST_DUP_${stamp}_ZEROED`);
    }
    expect(await owed(s.vyapariAId)).toBeCloseTo(afterFirst + 250, 2);
  });

  // the old server's mirror: snake was_null, legacy datetime, remark "", no flag
  it('a mirrored vasuli payload is accepted', async () => {
    const s = await getSeed();
    const r = await api.post('/party/vasuliTrasaction', [
      { vyapariId: s.vyapariAId, date: `${today()} 10:15:00`, amount: 40, remark: '', was_null: false },
    ]);
    expect(r.body.responseCode).toBe('200');
    await zeroVasuli(String((r.body.responseBody as any[])[0].id), s.vyapariAId, `TEST_MIRROR_Z_${Date.now()}`);
  });

  it('a vasuli without an amount is a pending request: owed untouched, listed as pending today', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    // the ledger's VASULI button: amount null, date as new Date().toJSON()
    const rows = unwrap<any[]>(
      await postVasuli([{ amount: null, date: new Date().toJSON(), vyapariId: s.vyapariAId, remark: null, name: 'x' }]),
    );
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
    const pending = unwrap<any[]>(await api.get('/vyapari/pending-vasuli?showToday=true'));
    const mine = pending.find((p) => p.id === rows[0].id);
    expect(mine).toBeTruthy();
    expect(mine.amount).toBeNull();
    expect(typeof mine.idNo).toBe('string');

    // filling it in (pending-vasuli screen) debits it once
    unwrap(await api.put('/vyapari/edit-vasuli', { amount: '120', vyapariId: s.vyapariAId, remark: '', id: rows[0].id }));
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-120, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_PENDING_Z_${Date.now()}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });
});

describe('vasuli: POST body validation', () => {
  const valid = { vyapariId: 'TEST_VYAPARI_AUTO_A_ID', date: '2026-07-18T12:00:00', amount: 10 };

  it.each([
    ['plain object instead of array', valid],
    ['missing vyapariId', [{ ...valid, vyapariId: undefined }]],
    ['empty vyapariId', [{ ...valid, vyapariId: '' }]],
    ['non-numeric amount', [{ ...valid, amount: 'lots' }]],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await postVasuli(body);
    expect(r.status).toBe(400);
  });

  it('rejects confirmDuplicate=banana with 400', async () => {
    const r = await postVasuli([{ ...valid }], '?confirmDuplicate=banana');
    expect(r.status).toBe(400);
  });

  // payloads the old server took and the frontends / its mirror really send
  it('accepts an empty remark (mandi-auction, mirror) and stores it as ""', async () => {
    const s = await getSeed();
    const rows = unwrap<any[]>(
      await postVasuli([{ vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 3, remark: '' }]),
    );
    const d = today();
    const list = unwrap<any>(await api.get(`/vyapari/vasuli-list?startDate=${d}&endDate=${d}`)).vasuliList;
    expect(list.find((v: any) => v.id === rows[0].id)?.remark).toBe('');
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_EMPTYREMARK_Z_${Date.now()}`);
  });

  it('accepts confirmDuplicate=TRUE (Spring parsed booleans case-insensitively)', async () => {
    const s = await getSeed();
    const r = await postVasuli([{ vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 2 }], '?confirmDuplicate=TRUE');
    expect(r.body.responseCode).toBe('200');
    await zeroVasuli(String((r.body.responseBody as any[])[0].id), s.vyapariAId, `TEST_TRUE_Z_${Date.now()}`);
  });

  it('empty array short-circuits to 200 with null body', async () => {
    const r = await postVasuli([]);
    expect(r.status).toBe(200);
    expect(r.body.responseBody ?? null).toBeNull();
  });
});

describe('vasuli: amount matrix — owed_amount -= amount exactly', () => {
  it.each([[0.01], [1], [99.99], [500.5], [12345.67], [100000], [0], [777.77], [42.4], [3.33]])(
    'amount=%s',
    async (amount) => {
      const s = await getSeed();
      const baseA = await owed(s.vyapariAId);
      const stamp = `${Date.now()}_${amount}`;

      const rows = unwrap<any[]>(
        await postVasuli([
          { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount, remark: `TEST_AMT_${stamp}` },
        ]),
      );
      expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-amount, 2);
      await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_AMT_${stamp}_Z`);
      expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
    },
  );

  it('numeric-string amount is coerced ("250.75")', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: '250.75', remark: `TEST_STR_${Date.now()}` },
      ]),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-250.75, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_STR_Z_${Date.now()}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });

  it('negative amount applies algebraically (owed -= amount means owed increases)', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: -50, remark: `TEST_NEG_${Date.now()}` },
      ]),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(50, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_NEG_Z_${Date.now()}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });

  it('bulk insert of three payments applies the sum and returns three ids', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const stamp = Date.now();
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 100, remark: `TEST_BULK1_${stamp}` },
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 200.5, remark: `TEST_BULK2_${stamp}` },
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 49.5, remark: `TEST_BULK3_${stamp}` },
      ]),
    );
    expect(rows).toHaveLength(3);
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-350, 2);
    for (const row of rows) await zeroVasuli(String(row.id), s.vyapariAId, `TEST_BULK_Z_${stamp}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });

  it('bulk insert across two vyaparis debits each separately', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const baseB = await owed(s.vyapariBId);
    const stamp = Date.now();
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 111, remark: `TEST_AB_A_${stamp}` },
        { vyapariId: s.vyapariBId, date: `${today()}T12:00:00`, amount: 222, remark: `TEST_AB_B_${stamp}` },
      ]),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-111, 2);
    expect((await owed(s.vyapariBId)) - baseB).toBeCloseTo(-222, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_AB_ZA_${stamp}`);
    await zeroVasuli(String(rows[1].id), s.vyapariBId, `TEST_AB_ZB_${stamp}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
    expect(await owed(s.vyapariBId)).toBeCloseTo(baseB, 2);
  });
});

describe('vasuli: edit-vasuli validation and neutral edits', () => {
  it.each([
    ['missing id', { amount: 10 }],
    ['empty id', { id: '', amount: 10 }],
    ['non-numeric amount', { id: '00000000-0000-0000-0000-000000000000', amount: 'x' }],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await api.put('/vyapari/edit-vasuli', body);
    expect(r.status).toBe(400);
  });

  it('editing an unknown vasuli id -> 404, owed_amount untouched', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const r = await api.put('/vyapari/edit-vasuli', {
      id: '00000000-0000-0000-0000-000000000000',
      amount: 999,
      vyapariId: s.vyapariAId,
    });
    expect(r.status).toBe(404);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });

  it('edit answers the saved vasuli (mandi-auction needs a truthy body), camelCase', async () => {
    const s = await getSeed();
    const rows = unwrap<any[]>(
      await postVasuli([{ vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 9, remark: 'r' }]),
    );
    const saved = unwrap<any>(
      await api.put('/vyapari/edit-vasuli', { id: rows[0].id, amount: '0', vyapariId: s.vyapariAId, remark: '' }),
    );
    expect(saved).toMatchObject({ id: rows[0].id, vyapariId: s.vyapariAId, remark: '', wasNull: false });
    expect(Number(saved.amount)).toBe(0);
  });

  it('re-submitting the same amount with a new remark is money-neutral', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const stamp = Date.now();
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 80, remark: `TEST_REMARK_${stamp}` },
      ]),
    );
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id: String(rows[0].id),
        amount: 80,
        vyapariId: s.vyapariAId,
        date: `${today()}T12:00:00`,
        remark: `TEST_REMARK_${stamp}_CHANGED`,
      }),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-80, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_REMARK_Z_${stamp}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });

  it('changing only the date keeps owed_amount unchanged', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const stamp = Date.now();
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 60, remark: `TEST_DATE_${stamp}` },
      ]),
    );
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id: String(rows[0].id),
        amount: 60,
        vyapariId: s.vyapariAId,
        date: `${today()}T09:30:00`,
        remark: `TEST_DATE_${stamp}`,
      }),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-60, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_DATE_Z_${stamp}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });

  it('increasing an amount applies only the delta', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const stamp = Date.now();
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 300, remark: `TEST_INCR_${stamp}` },
      ]),
    );
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id: String(rows[0].id),
        amount: 450,
        vyapariId: s.vyapariAId,
        date: `${today()}T12:00:00`,
        remark: `TEST_INCR_${stamp}`,
      }),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-450, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_INCR_Z_${stamp}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });

  it('was_null=true is accepted on insert', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const stamp = Date.now();
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 15, remark: `TEST_WASNULL_${stamp}`, was_null: true },
      ]),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-15, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_WASNULL_Z_${stamp}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });
});

describe('vasuli: lists', () => {
  it.each([
    ['missing startDate', `endDate=${today()}`],
    ['missing endDate', `startDate=${today()}`],
    ['both missing', ''],
  ])('vasuli-list rejects %s with 400', async (_label, qs) => {
    const r = await api.get(`/vyapari/vasuli-list?${qs}`);
    expect(r.status).toBe(400);
  });

  it('a far-past range excludes today’s entries and sums to its own rows', async () => {
    const body = unwrap<any>(await api.get('/vyapari/vasuli-list?startDate=2000-01-01&endDate=2000-01-02'));
    const list: any[] = body?.vasuliList ?? [];
    expect(list).toHaveLength(0);
    expect(Number(body?.totalVasuli ?? 0)).toBe(0);
  });

  it('pending-vasuli responds 200 with and without showToday', async () => {
    const r1 = await api.get('/vyapari/pending-vasuli');
    const r2 = await api.get('/vyapari/pending-vasuli?showToday=true');
    const r3 = await api.get('/vyapari/pending-vasuli?showToday=false');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });

  it('pending-vasuli rejects a non-boolean showToday with 400', async () => {
    const r = await api.get('/vyapari/pending-vasuli?showToday=banana');
    expect(r.status).toBe(400);
  });

  it('a Hindi remark round-trips through vasuli-list', async () => {
    const s = await getSeed();
    const stamp = Date.now();
    const remark = `वसूली परीक्षण ${stamp}`;
    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 5, remark },
      ]),
    );
    const d = today();
    const listBody = unwrap<any>(await api.get(`/vyapari/vasuli-list?startDate=${d}&endDate=${d}`));
    const mine = (listBody?.vasuliList ?? []).find((v: any) => String(v.id) === String(rows[0].id));
    expect(mine?.remark).toBe(remark);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_HINDI_Z_${stamp}`);
  });

  it('a vasuli dated yesterday appears in yesterday’s range, not today’s', async () => {
    const s = await getSeed();
    const stamp = Date.now();
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yd = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;

    const rows = unwrap<any[]>(
      await postVasuli([
        { vyapariId: s.vyapariAId, date: `${yd}T12:00:00`, amount: 7, remark: `TEST_YDAY_${stamp}` },
      ]),
    );
    const id = String(rows[0].id);

    const yList = unwrap<any>(await api.get(`/vyapari/vasuli-list?startDate=${yd}&endDate=${yd}`));
    expect((yList?.vasuliList ?? []).some((v: any) => String(v.id) === id)).toBe(true);

    const d = today();
    const tList = unwrap<any>(await api.get(`/vyapari/vasuli-list?startDate=${d}&endDate=${d}`));
    expect((tList?.vasuliList ?? []).some((v: any) => String(v.id) === id)).toBe(false);

    // zero it out on its own date
    unwrap(
      await api.put('/vyapari/edit-vasuli', {
        id,
        amount: 0,
        vyapariId: s.vyapariAId,
        date: `${yd}T12:00:00`,
        remark: `TEST_YDAY_Z_${stamp}`,
      }),
    );
  });
});
