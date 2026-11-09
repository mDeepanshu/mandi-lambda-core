/**
 * The mandi operates in IST (Asia/Kolkata, UTC+5:30) and the business date
 * columns are naive (`timestamp without time zone` / `date`), so a value only
 * means the right thing if its wall-clock digits are already IST.
 *
 * Clients do not agree on this. A browser calling `new Date().toISOString()`
 * sends an absolute UTC instant ("2026-07-18T20:19:00.880Z"); Postgres casts
 * that with `::timestamp`, which silently DROPS the zone and stores 20:19 on
 * the 18th -- 5h30m behind the 01:49 on the 19th that the mandi is actually
 * living in. Reports keyed on that column then land on the wrong day.
 */

const IST_ZONE = 'Asia/Kolkata';

/** Trailing zone designator: "Z", "+05:30", "-0800". */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Normalise a client-supplied datetime to IST wall-clock, naive.
 *
 * Deliberately conservative: only strings that carry an explicit zone are
 * converted, because only those are unambiguously absolute instants. A naive
 * string ("2026-07-19T12:00:00") is already someone's local wall-clock and is
 * passed through untouched.
 *
 * That makes this idempotent and safe to apply broadly -- once a client is
 * fixed to send naive IST, this becomes a no-op rather than double-shifting.
 * Unparseable input is returned unchanged so validation, not this helper, owns
 * rejecting it.
 */
export function toIstNaive(input?: string | null): string | undefined {
  if (input == null) return undefined;
  const raw = String(input).trim();
  if (raw === '') return undefined;
  if (!HAS_ZONE.test(raw)) return raw;

  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw;

  // 'sv-SE' formats as "YYYY-MM-DD HH:mm:ss"; swap the separator for 'T' so the
  // result matches the naive ISO shape the rest of the payload uses.
  const wall = new Intl.DateTimeFormat('sv-SE', {
    timeZone: IST_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ms));

  return wall.replace(' ', 'T');
}

/** A date followed by a time of day: "2026-11-09T05:00:10", "2026-11-09 05:00". */
const HAS_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/;

/**
 * Like toIstNaive, but a zone-less datetime is read as UTC, not as local time.
 *
 * Use this only for inputs whose sender is known to send UTC without the
 * zone. The auction app sends each lot's entry time as
 * `toISOString().slice(0, -1)`, which is UTC with the trailing "Z" cut off.
 * The old Java server parsed that as UTC, through Jackson's default zone.
 * Date-only and unparseable values are returned unchanged.
 */
export function utcToIstNaive(input?: string | null): string | undefined {
  if (input == null) return undefined;
  const raw = String(input).trim();
  if (raw === '') return undefined;
  if (HAS_ZONE.test(raw) || !HAS_TIME.test(raw)) return toIstNaive(raw);
  return Number.isNaN(Date.parse(`${raw.replace(' ', 'T')}Z`))
    ? raw
    : toIstNaive(`${raw.replace(' ', 'T')}Z`);
}
