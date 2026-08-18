import { describe, expect, it } from 'vitest';
import { api, unwrap } from './helpers/client';
import { getSeed } from './helpers/seed';
import { toIstNaive } from '../../src/common/datetime';

// ---------------------------------------------------------------------------
// Regressions for the IST timezone fix (db/fix_ist_timezone*.sql, 2026-07-19).
//
// The Supabase session runs in UTC; the mandi runs in IST (UTC+5:30). Every
// NOW()/CURRENT_DATE/CURRENT_TIMESTAMP feeding a NAIVE column (`timestamp
// without time zone` / `date`) therefore captured UTC wall-clock as if it were
// local time. The worst case was create_auction_bulk_with_crate stamping
// auction_transaction.auction_date, which put a whole day's business on the
// wrong date between 00:00 and 05:30 IST.
//
// These tests assert on the OFFSET, not on the date. That distinction matters:
// a date-based assertion only diverges during the 5.5h window after IST
// midnight, so it would pass ~77% of the day and give false confidence. The
// bug was a fixed 5h30m skew, which is visible at every hour of the day -- so
// comparing a freshly written timestamp against IST wall-clock catches a
// regression whenever the suite happens to run.
//
// Everything here is computed from Intl with an explicit Asia/Kolkata zone,
// never from the machine's local clock, so it behaves the same on a developer
// laptop in IST and on a CI box in UTC.
// ---------------------------------------------------------------------------

/**
 * IST wall-clock "now", expressed as the epoch ms you would get by reading
 * those wall-clock digits as if they were UTC. Naive DB timestamps are
 * compared in the same frame, so the two are directly subtractable.
 */
function istWallClockMs(): number {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}

/** A naive DB timestamp ("2026-07-19T01:26:49" / "... 01:26:49") in the same frame. */
const naiveMs = (ts: string): number => Date.parse(`${ts.replace(' ', 'T').slice(0, 19)}Z`);

const istToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata' }).format(new Date());

const MINUTE = 60_000;
// Generous enough to absorb request latency and modest host/DB clock drift,
// but far below the 5h30m the bug produced.
const TOLERANCE = 10 * MINUTE;

/** How far a server-written timestamp sits from IST now, in minutes (signed). */
const skewMinutes = (ts: string) => (naiveMs(ts) - istWallClockMs()) / MINUTE;

describe('toIstNaive: normalising client-supplied datetimes', () => {
  it('converts a zoned instant to IST wall-clock', () => {
    // the exact shape a browser sends via new Date().toISOString()
    expect(toIstNaive('2026-07-18T20:19:00.880Z')).toBe('2026-07-19T01:49:00');
    // +5:30 past midnight UTC is the case that moved business to the wrong day
    expect(toIstNaive('2026-07-18T19:00:00Z')).toBe('2026-07-19T00:30:00');
    expect(toIstNaive('2026-07-18T06:30:00Z')).toBe('2026-07-18T12:00:00');
  });

  it('honours non-UTC offsets rather than assuming Z', () => {
    // 2026-07-18T12:00 in IST expressed in its own zone -- must round-trip
    expect(toIstNaive('2026-07-18T12:00:00+05:30')).toBe('2026-07-18T12:00:00');
    expect(toIstNaive('2026-07-18T00:00:00-08:00')).toBe('2026-07-18T13:30:00');
  });

  it('passes naive input through untouched, so it is idempotent', () => {
    // already someone's wall-clock -- converting again would double-shift
    expect(toIstNaive('2026-07-19T12:00:00')).toBe('2026-07-19T12:00:00');
    expect(toIstNaive(toIstNaive('2026-07-18T20:19:00.880Z'))).toBe('2026-07-19T01:49:00');
  });

  it('leaves empty and unparseable values for validation to reject', () => {
    expect(toIstNaive(undefined)).toBeUndefined();
    expect(toIstNaive(null)).toBeUndefined();
    expect(toIstNaive('   ')).toBeUndefined();
    expect(toIstNaive('not-a-date')).toBe('not-a-date');
  });
});

describe('timezone: server-written timestamps are IST, not UTC', () => {
  it('auction_transaction.auction_date is stamped in IST', async () => {
    const s = await getSeed();
    const day = istToday();
    const window = `startDate=${encodeURIComponent(`${day} 00:00:00`)}&endDate=${encodeURIComponent(`${day} 23:59:59`)}`;

    const idsBefore = new Set(
      (unwrap<any>(await api.get(`/auction/list-auction-transaction?${window}`))?.auctionTransactions ?? [])
        .filter((t: any) => t.vyapariId === s.vyapariAId)
        .map((t: any) => t.auctionTransactionId),
    );

    unwrap(
      await api.post(
        '/auction',
        [
          {
            kisanId: s.kisanId,
            itemId: s.itemId,
            // exactly what a browser sends: the current instant, zoned UTC.
            // The TS shim (src/common/datetime.ts) must convert it to IST
            // wall-clock before it reaches the DB.
            auctionDate: new Date().toISOString(),
            buyItems: [{ vyapariId: s.vyapariAId, bag: 1, rate: 11, quantity: 1, chungi: 0 }],
          },
        ],
        { deviceId: s.deviceId },
      ),
    );

    const created = (
      unwrap<any>(await api.get(`/auction/list-auction-transaction?${window}`))?.auctionTransactions ?? []
    ).filter((t: any) => t.vyapariId === s.vyapariAId && !idsBefore.has(t.auctionTransactionId));
    expect(created).toHaveLength(1);

    try {
      // auction_date now inherits the payload's auctionDate (backdating
      // support), so for a live entry the stored value must be the IST
      // rendering of the instant we just sent. If the shim is removed or the
      // zone is mishandled anywhere in the pipeline, the UTC wall-clock gets
      // stored instead and this sits 330 minutes off. Both date columns must
      // agree -- that is what keeps the two reports reconciled.
      expect(Math.abs(skewMinutes(created[0].auctionDate))).toBeLessThan(TOLERANCE / MINUTE);
      expect(Math.abs(skewMinutes(created[0].auctionSubmitDate))).toBeLessThan(TOLERANCE / MINUTE);

      // and it therefore lands on the mandi's day, which is what makes
      // /auction/generate-ledger agree with /auction/list-auction-transaction
      expect(String(created[0].auctionDate).slice(0, 10)).toBe(day);
    } finally {
      await api.del('/auction/delete-auction-transaction', {
        auctionTransactionIds: [created[0].auctionTransactionId],
      });
    }
  });

  it('the device_details updation_time trigger fires in IST', async () => {
    const s = await getSeed();

    // Re-approving is a no-op status-wise but still trips the trigger, so this
    // exercises the write path without leaving a new device row behind.
    unwrap(await api.put(`/device/${s.deviceId}/status?status=APPROVED`));

    const devices = unwrap<any[]>(await api.get('/device/listDevices?status=APPROVED')) ?? [];
    const device = devices.find((d) => Number(d.id) === Number(s.deviceId));
    expect(device).toBeDefined();
    expect(device.updation_time).toBeTruthy();

    expect(Math.abs(skewMinutes(device.updation_time))).toBeLessThan(TOLERANCE / MINUTE);
  });

  it('vasuli stores the date it is given, untouched by any zone conversion', async () => {
    const s = await getSeed();
    const day = istToday();
    const stamp = Date.now();

    // vasuli.date comes from the payload rather than the server clock -- pinned
    // so a future "let's convert everything" change cannot silently shift it.
    const rows = unwrap<any[]>(
      await api.post('/party/vasuliTrasaction', [
        { vyapariId: s.vyapariBId, date: `${day}T09:30:00`, amount: 50, remark: `TEST_TZ_${stamp}` },
      ]),
    );
    const id = String(rows[0].id);

    try {
      const list =
        unwrap<any>(await api.get(`/vyapari/vasuli-list?startDate=${day}&endDate=${day}`))?.vasuliList ?? [];
      const mine = list.find((v: any) => String(v.id) === id);
      expect(mine).toBeDefined();
      expect(String(mine.date).slice(0, 10)).toBe(day);
      expect(String(mine.date)).toContain('09:30');
    } finally {
      unwrap(
        await api.put('/vyapari/edit-vasuli', {
          id,
          amount: 0,
          vyapariId: s.vyapariBId,
          date: `${day}T09:30:00`,
          remark: `TEST_TZ_${stamp}_ZEROED`,
        }),
      );
    }
  });
});
