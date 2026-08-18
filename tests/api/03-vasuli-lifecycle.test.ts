import { describe, expect, it } from 'vitest';
import { api, unwrap, today } from './helpers/client';
import { getSeed } from './helpers/seed';
import { owed } from './helpers/party';

// Dev/his DB invariants (db/vasuli_owed_amount.sql):
//   insert:              owed_amount -= amount
//   edit (same vyapari): owed_amount += old.amount - new.amount
//   edit (reassign A->B): A.owed_amount += old.amount, B.owed_amount -= new.amount

const postVasuli = (rows: unknown, qs = '') => api.post(`/party/vasuliTrasaction${qs}`, rows);

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

  it('duplicate handling: owed_amount moves only by accepted inserts; confirmDuplicate=true never errors', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const stamp = Date.now();
    const payload = [
      { vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 250, remark: `TEST_DUP_${stamp}` },
    ];

    const ids: string[] = [];

    const first = await postVasuli(payload);
    expect(first.status).toBe(200);
    ids.push(String((first.body.responseBody as any[])?.[0]?.id));

    // identical re-post without confirmDuplicate: either rejected (owed unchanged)
    // or accepted (owed moves) — pin that owed matches whichever happened
    const second = await postVasuli(payload);
    let accepted = 1;
    if (second.status === 200 && (second.body.responseBody as any[])?.[0]?.id) {
      accepted += 1;
      ids.push(String((second.body.responseBody as any[])[0].id));
    }
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-250 * accepted, 2);

    // with confirmDuplicate=true the API must not error
    const third = await postVasuli(payload, '?confirmDuplicate=true');
    expect(third.status).toBe(200);
    if ((third.body.responseBody as any[])?.[0]?.id) {
      accepted += 1;
      ids.push(String((third.body.responseBody as any[])[0].id));
    }
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-250 * accepted, 2);

    // today's vasuli list contains what was accepted, and its totalVasuli
    // equals the sum of the listed amounts
    const d = today();
    const listBody = unwrap<any>(await api.get(`/vyapari/vasuli-list?startDate=${d}&endDate=${d}`));
    const list: any[] = listBody?.vasuliList ?? [];
    const mine = list.filter((v: any) => ids.includes(String(v.id)));
    expect(mine.length).toBe(accepted);
    const sumOfAmounts = list.reduce((sum, v) => sum + Number(v.amount ?? 0), 0);
    expect(Number(listBody.totalVasuli)).toBeCloseTo(sumOfAmounts, 2);

    // neutralize drift: zero out every accepted insert
    for (const id of ids) {
      await zeroVasuli(id, s.vyapariAId, `TEST_DUP_${stamp}_ZEROED`);
    }
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });
});

describe('vasuli: POST body validation', () => {
  const valid = { vyapariId: 'TEST_VYAPARI_AUTO_A_ID', date: '2026-07-18T12:00:00', amount: 10 };

  it.each([
    ['plain object instead of array', valid],
    ['missing vyapariId', [{ ...valid, vyapariId: undefined }]],
    ['empty vyapariId', [{ ...valid, vyapariId: '' }]],
    ['missing date', [{ ...valid, date: undefined }]],
    ['empty date', [{ ...valid, date: '' }]],
    ['missing amount', [{ ...valid, amount: undefined }]],
    ['non-numeric amount', [{ ...valid, amount: 'lots' }]],
    ['empty remark (must be omitted or non-empty)', [{ ...valid, remark: '' }]],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await postVasuli(body);
    expect(r.status).toBe(400);
  });

  it.each([
    ['confirmDuplicate=banana', '?confirmDuplicate=banana'],
    ['confirmDuplicate=TRUE (case-sensitive)', '?confirmDuplicate=TRUE'],
  ])('rejects %s with 400', async (_label, qs) => {
    const r = await postVasuli([{ ...valid }], qs);
    expect(r.status).toBe(400);
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
    ['empty remark', { id: '00000000-0000-0000-0000-000000000000', amount: 1, remark: '' }],
    ['non-boolean wasNull', { id: '00000000-0000-0000-0000-000000000000', amount: 1, wasNull: 'yes' }],
  ])('rejects %s with 400', async (_label, body) => {
    const r = await api.put('/vyapari/edit-vasuli', body);
    expect(r.status).toBe(400);
  });

  it('editing an unknown vasuli id does not silently succeed with data', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const r = await api.put('/vyapari/edit-vasuli', {
      id: '00000000-0000-0000-0000-000000000000',
      amount: 999,
      vyapariId: s.vyapariAId,
    });
    // pin: whatever the RPC does with a ghost id, it must not touch owed_amount
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
    expect([200, 404, 500]).toContain(r.status);
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

  it('confirmDuplicate=false behaves like omitting the flag', async () => {
    const s = await getSeed();
    const baseA = await owed(s.vyapariAId);
    const stamp = Date.now();
    const rows = unwrap<any[]>(
      await postVasuli(
        [{ vyapariId: s.vyapariAId, date: `${today()}T12:00:00`, amount: 33, remark: `TEST_CDF_${stamp}` }],
        '?confirmDuplicate=false',
      ),
    );
    expect((await owed(s.vyapariAId)) - baseA).toBeCloseTo(-33, 2);
    await zeroVasuli(String(rows[0].id), s.vyapariAId, `TEST_CDF_Z_${stamp}`);
    expect(await owed(s.vyapariAId)).toBeCloseTo(baseA, 2);
  });
});
