/**
 * Timeline of the write calls a stage received, from CloudWatch (read-only):
 * who (deviceId / origin), what was sent, what it answered, and every
 * affected party's owed_amount before -> after ("Owed audit" lines).
 *
 *   npm run activity -- --stage hmb --since 3h            # last 3 hours (m/h/d)
 *   npm run activity -- --stage hmb --from 2026-11-04T09:00:00+05:30 [--to …]
 *   npm run activity -- --stage hmb --since 1h --all      # reads too
 *
 * Needs the AWS CLI logged in to the account the lambdas run in.
 */
import { execFileSync } from 'node:child_process';

const arg = (flag: string) => {
  const at = process.argv.indexOf(flag);
  return at !== -1 ? process.argv[at + 1] : undefined;
};

const stage = arg('--stage') ?? 'dev';
const includeReads = process.argv.includes('--all');
const since = arg('--since');
const units: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const start = arg('--from')
  ? Date.parse(arg('--from')!)
  : Date.now() - (since ? Number(since.slice(0, -1)) * (units[since.slice(-1)] ?? 0) : 3_600_000);
const end = arg('--to') ? Date.parse(arg('--to')!) : Date.now();
if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('bad --since/--from/--to');

const FUNCTIONS = ['auction', 'party', 'vyapari', 'item', 'device', 'bill', 'kisan', 'crate'];
const WRITE = /^(POST|PUT|PATCH|DELETE)$/;
const ist = (ms: number) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
const clip = (s: unknown, n = 300) => {
  const t = typeof s === 'string' ? s : JSON.stringify(s);
  return t && t.length > n ? `${t.slice(0, n)}…` : t;
};

type Line = Record<string, any>;
const requests = new Map<string, { fn: string; t: number; lines: Line[] }>();

for (const fn of FUNCTIONS) {
  let out: string;
  try {
    out = execFileSync('aws', [
      'logs', 'filter-log-events', '--region', 'ap-south-1',
      '--log-group-name', `/aws/lambda/mandi-lambda-core-${stage}-${fn}`,
      '--start-time', String(start), '--end-time', String(end),
      '--output', 'json', '--query', 'events[].message',
    ], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'pipe'],
      // the CLI's bundled Python prints with the Windows code page otherwise,
      // and dies on the Hindi item / party names in the logs
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
  } catch (e) {
    if (String((e as any).stderr).includes('ResourceNotFound')) continue;
    throw e;
  }
  for (const msg of JSON.parse(out) as string[]) {
    let line: Line;
    try { line = JSON.parse(msg); } catch { continue; } // REPORT / START lines
    if (!line.requestId) continue;
    const r = requests.get(line.requestId) ?? { fn, t: Date.parse(line.timestamp), lines: [] };
    r.lines.push(line);
    requests.set(line.requestId, r);
  }
}

let shown = 0;
for (const [requestId, r] of [...requests].sort((a, b) => a[1].t - b[1].t)) {
  const recv = r.lines.find((l) => l.message === 'Request received');
  if (!recv || (!includeReads && !WRITE.test(recv.method))) continue;
  const payload = r.lines.find((l) => l.message === 'Request payload');
  const done = r.lines.find((l) => l.message === 'Request completed');
  const resp = r.lines.find((l) => l.message === 'Response body');
  let code = '';
  try { code = JSON.parse(resp?.body ?? '{}').responseCode ?? ''; } catch { /* non-JSON */ }

  shown++;
  console.log(`\n${ist(r.t)}  ${recv.method} ${recv.path}  -> HTTP ${done?.statusCode ?? '?'} code ${code}  (${done?.durationMs ?? '?'}ms)`);
  console.log(`  device ${recv.deviceId ?? '-'}  origin ${recv.origin ?? '-'}  request ${requestId}`);
  if (payload?.query) console.log(`  query ${clip(payload.query)}`);
  if (payload?.body) console.log(`  body  ${clip(payload.body)}`);
  for (const audit of r.lines.filter((l) => l.message === 'Owed audit')) {
    for (const c of audit.changes ?? []) {
      console.log(`  owed  ${c.name ?? c.partyId} (${c.partyId}): ${c.before} -> ${c.after}  Δ ${c.delta}`);
    }
  }
  for (const e of r.lines.filter((l) => l.level === 'ERROR' || l.level === 'WARN')) {
    console.log(`  ${e.level} ${e.message} ${clip(e.rawError?.message ?? e.errorMessage ?? e.error ?? '', 200)}`);
  }
  if (code && code !== '200' && code !== '201') console.log(`  answer ${clip(resp?.body, 300)}`);
}
console.log(`\n${shown} ${includeReads ? '' : 'write '}call(s), ${stage}, ${ist(start)} – ${ist(end)} IST`);
