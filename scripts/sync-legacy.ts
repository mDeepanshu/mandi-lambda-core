/**
 * Make a client's Supabase data match the legacy MySQL system.
 *
 *   npm run sync:legacy -- --stage his --dry-run   # full run, then ROLLBACK
 *   npm run sync:legacy -- --stage hmb
 *
 * The legacy DB is READ-ONLY: the session is forced read-only and every query
 * is a SELECT. Credentials come from .env (LEGACY_MYSQL_* for the source,
 * SUPABASE_DB_URL_<STAGE> for the target).
 *
 * Transactional tables (auction, auction_transaction, vasuli, kisan_bill*,
 * vyapari_bill*) are wiped and reloaded, which also drops the copies the old
 * server mirrored in under lambda-generated ids. Masters (party, items,
 * device_details) are upserted and never deleted: lambda-native crate rows FK
 * party, and devices register directly against the lambda.
 *
 * Everything on the Supabase side runs in one transaction, so a failure leaves
 * the stage untouched. Re-runnable: each run is a full reload.
 */
// must stay first — loads .env and resolves --stage
import { stage } from './bootstrap-env';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

const LEGACY_DB: Record<string, string | undefined> = {
  his: process.env.LEGACY_MYSQL_DB_HIS,
  hmb: process.env.LEGACY_MYSQL_DB_HMB,
};

type Row = Record<string, unknown>;

interface TableSpec {
  table: string;
  /** legacy SELECT list, aliased to the Postgres column names */
  select: string;
  /** extra Postgres columns derived in SQL from the loaded row */
  derived?: Record<string, string>;
  map?: (row: Row) => Row;
}

const bit = (value: unknown) => (Buffer.isBuffer(value) ? value[0] === 1 : value == null ? null : Boolean(value));

const MASTERS: TableSpec[] = [
  { table: 'items', select: 'item_id, name' },
  {
    table: 'device_details',
    select: 'id, creation_date, name, status, updation_time',
  },
  {
    // legacy `commission` is `commission_rate` here; legacy `chungi` has no
    // Postgres column. Explicit names matter: the two tables' trailing columns
    // are in a different order.
    table: 'party',
    select: `party_id, id_no, contact, name, owed_amount, party_type, max_loan_days, last_vasuli_date,
             ledger_order, last_notified_amount, party_code, kisan_type, auto_ledger,
             commission AS commission_rate`,
  },
];

// parents before children — the order rows are inserted in
const RELOADED: TableSpec[] = [
  {
    table: 'auction',
    select: 'auction_id, auction_date, item_id, kisan_id, bag AS total_bags, device_id',
    map: (row) => ({ ...row, device_id: row.device_id == null || row.device_id === '' ? null : Number(row.device_id) }),
  },
  {
    table: 'auction_transaction',
    select: `auction_transaction_id, auction_date, auction_id, bag, quantity, rate, vyapari_id, parent_id,
             is_old, chungi, bag_wise_quantity, txn_no, validated`,
    // not in the legacy schema; same convention as db/add_auction_txn_created_at.sql
    derived: { created_at: `auction_date AT TIME ZONE 'Asia/Kolkata'` },
  },
  {
    table: 'vasuli',
    select: 'id, amount, date, vyapari_id, remark, was_null',
    map: (row) => ({ ...row, was_null: bit(row.was_null) }),
  },
  {
    table: 'kisan_bill',
    select: `kisan_bill_id, kisan_name, bill_date, mandi_kharcha, hammali, nagar_palika_tax, bhada,
             driver_inaam, nagdi, commission, kharcha_total, pakki_bikri, kisan_id`,
  },
  {
    table: 'kisan_bill_item',
    select: `kisan_bill_item_id, kisan_bill_id, item_name, bag, rate, quantity, item_total,
             vyapari_name, vyapari_id, date`,
  },
  {
    table: 'vyapari_bill',
    select: 'id, bill_date, created_at, current_outstanding, updated_at, vyapari_id, vyapari_name',
  },
  {
    table: 'vyapari_bill_item',
    select: 'id, bag, rate, quantity, created_at, item_name, item_total, updated_at, vyapari_bill_id',
  },
];

const PRIMARY_KEY: Record<string, string> = { items: 'item_id', device_details: 'id', party: 'party_id' };

const SEQUENCES: [string, string, string][] = [
  ['party_id_no_seq', 'party', 'id_no'],
  ['device_details_id_seq', 'device_details', 'id'],
  ['kisan_bill_kisan_bill_id_seq', 'kisan_bill', 'kisan_bill_id'],
  ['kisan_bill_item_kisan_bill_item_id_seq', 'kisan_bill_item', 'kisan_bill_item_id'],
  ['vyapari_bill_id_seq', 'vyapari_bill', 'id'],
  ['vyapari_bill_item_id_seq', 'vyapari_bill_item', 'id'],
];

const CHUNK = 5000;

async function readLegacy(database: string): Promise<Map<string, Row[]>> {
  const conn = await mysql.createConnection({
    host: process.env.LEGACY_MYSQL_HOST,
    user: process.env.LEGACY_MYSQL_USER,
    password: process.env.LEGACY_MYSQL_PASSWORD,
    database,
    // keep timestamps as the wall-clock strings MySQL stores (IST)
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: 20000,
  });

  try {
    await conn.query(`SET time_zone = '+00:00'`);
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    // one snapshot for every table, so parents and children agree
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

    const data = new Map<string, Row[]>();
    for (const spec of [...MASTERS, ...RELOADED]) {
      const [rows] = await conn.query(`SELECT ${spec.select} FROM \`${spec.table}\``);
      data.set(spec.table, (rows as Row[]).map(spec.map ?? ((row) => row)));
      console.log(`  read ${spec.table.padEnd(20)} ${(rows as Row[]).length}`);
    }
    await conn.query('ROLLBACK');
    return data;
  } finally {
    await conn.end();
  }
}

function connectSupabase(): Client {
  const raw = process.env[`SUPABASE_DB_URL_${stage.toUpperCase()}`];
  if (!raw) throw new Error(`SUPABASE_DB_URL_${stage.toUpperCase()} is not set in .env`);

  // The direct db.<ref>.supabase.co host is IPv6-only; the session pooler
  // speaks IPv4 and supports long transactions.
  const url = new URL(raw);
  const ref = url.hostname.split('.')[1];
  return new Client({
    host: 'aws-1-ap-south-1.pooler.supabase.com',
    port: 5432,
    user: `postgres.${ref}`,
    password: decodeURIComponent(url.password),
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
  });
}

async function insertRows(db: Client, spec: TableSpec, rows: Row[], upsert = false): Promise<void> {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  if (!cols.length) return;

  const derived = Object.entries(spec.derived ?? {});
  const target = [...cols, ...derived.map(([col]) => col)].join(', ');
  const source = [...cols, ...derived.map(([, expr]) => expr)].join(', ');
  const key = PRIMARY_KEY[spec.table];
  const conflict = upsert
    ? ` ON CONFLICT (${key}) DO UPDATE SET ${cols
        .filter((col) => col !== key)
        .map((col) => `${col} = EXCLUDED.${col}`)
        .join(', ')}`
    : '';

  for (let at = 0; at < rows.length; at += CHUNK) {
    await db.query(
      `INSERT INTO ${spec.table} (${target})
       SELECT ${source} FROM json_populate_recordset(NULL::${spec.table}, $1::json)${conflict}`,
      [JSON.stringify(rows.slice(at, at + CHUNK))],
    );
  }
}

async function count(db: Client, table: string): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const database = LEGACY_DB[stage];
  if (!database) {
    throw new Error(`No legacy database for stage "${stage}" — only his and hmb have one`);
  }

  console.log(`stage=${stage} legacy=${database}${dryRun ? ' (dry run — will ROLLBACK)' : ''}`);
  console.log('reading legacy…');
  const legacy = await readLegacy(database);

  const db = connectSupabase();
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL statement_timeout = 0');

    const before: Record<string, number> = {};
    for (const { table } of [...MASTERS, ...RELOADED]) before[table] = await count(db, table);

    // kisan_bill_pending_stock is lambda-native and FKs kisan_bill; refuse
    // rather than silently orphan it
    const pending = await count(db, 'kisan_bill_pending_stock');
    if (pending > 0) {
      throw new Error(`kisan_bill_pending_stock has ${pending} rows — reloading kisan_bill would orphan them`);
    }

    // Both systems hand out party.id_no, so a Supabase-only party can hold a
    // number legacy has since given to someone else. id_no is a display
    // number only; move ours out of the way.
    const parties = legacy.get('party')!;
    const { rows: clashes } = await db.query(
      `SELECT party_id FROM party WHERE NOT (party_id = ANY($1::text[])) AND id_no = ANY($2::int[])`,
      [parties.map((row) => row.party_id), parties.map((row) => row.id_no)],
    );
    for (const { party_id } of clashes) {
      await db.query(
        `UPDATE party SET id_no = GREATEST((SELECT max(id_no) FROM party), $2::int) + 1 WHERE party_id = $1`,
        [party_id, Math.max(...parties.map((row) => Number(row.id_no)))],
      );
      console.log(`  renumbered Supabase-only party "${party_id}" (id_no clashed with legacy)`);
    }

    // A few legacy vasulis carry vyapari_id = ''. A stage that has the ''
    // placeholder party keeps them as-is; elsewhere they'd break the FK.
    const { rowCount: hasPlaceholder } = await db.query(`SELECT 1 FROM party WHERE party_id = ''`);
    if (!hasPlaceholder) {
      for (const row of legacy.get('vasuli')!) if (row.vyapari_id === '') row.vyapari_id = null;
    }

    console.log('upserting masters…');
    // would stamp now() over legacy's updation_time; transactional, so a
    // failed run leaves it enabled
    await db.query('ALTER TABLE device_details DISABLE TRIGGER device_details_updation_time_trigger');
    for (const spec of MASTERS) await insertRows(db, spec, legacy.get(spec.table)!, true);
    await db.query('ALTER TABLE device_details ENABLE TRIGGER device_details_updation_time_trigger');

    console.log('wiping transactional tables…');
    await db.query('TRUNCATE auction_transaction, auction, vasuli, kisan_bill_item, vyapari_bill_item, vyapari_bill');
    // kisan_bill_pending_stock FKs kisan_bill, and TRUNCATE refuses any
    // FK-referenced table even when the referencing one is empty
    await db.query('DELETE FROM kisan_bill');

    console.log('loading…');
    for (const spec of RELOADED) {
      await insertRows(db, spec, legacy.get(spec.table)!);
      console.log(`  loaded ${spec.table}`);
    }

    for (const spec of MASTERS) {
      const key = PRIMARY_KEY[spec.table];
      const { rows: extra } = await db.query(
        `SELECT ${key} FROM ${spec.table} WHERE NOT (${key}::text = ANY($1::text[]))`,
        [legacy.get(spec.table)!.map((row) => String(row[key]))],
      );
      if (extra.length) console.log(`  ${spec.table}: kept Supabase-only ${extra.map((r) => JSON.stringify(r[key])).join(', ')}`);
    }

    for (const [seq, table, col] of SEQUENCES) {
      await db.query(`SELECT setval('${seq}', GREATEST((SELECT COALESCE(max(${col}), 0) FROM ${table}), 1))`);
    }

    console.log('\ntable                 before   legacy    after');
    let mismatch = false;
    for (const { table } of [...MASTERS, ...RELOADED]) {
      const want = legacy.get(table)!.length;
      const got = await count(db, table);
      const flag = got === want ? '' : MASTERS.some((m) => m.table === table) ? '  (+ Supabase-only, kept)' : '  ✗';
      if (flag === '  ✗') mismatch = true;
      console.log(`${table.padEnd(20)} ${String(before[table]).padStart(8)} ${String(want).padStart(8)} ${String(got).padStart(8)}${flag}`);
    }

    const { rows: orphans } = await db.query(
      `SELECT count(*)::int AS n FROM crate_transaction c
       WHERE c.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auction a WHERE a.auction_id::text = c.parent_id)`,
    );
    if (orphans[0].n) console.log(`\nnote: ${orphans[0].n} crate_transaction rows point at auctions no longer present`);

    if (mismatch) throw new Error('row counts do not match legacy — rolled back');

    if (dryRun) {
      await db.query('ROLLBACK');
      console.log('\ndry run OK — rolled back (sequence bumps are not transactional and stay)');
    } else {
      await db.query('COMMIT');
      console.log('\ncommitted');
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
