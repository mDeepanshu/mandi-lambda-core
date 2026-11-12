# Database backup & restore

`his` and `hmb` are backed up every night at ~02:00 IST by the GitHub Actions
workflow [.github/workflows/db-backup.yml](../.github/workflows/db-backup.yml).
`dev` is not backed up (test data).

## What is stored

- `pg_dump --format=custom --schema=public`: every table's data plus all
  functions (RPCs), triggers, RLS policies, sequences and grants.
- **Not** included: the Supabase-managed schemas (`auth`, `storage`, `vault`,
  `realtime`). `auth.users` is empty, and the only Storage content is the TTS
  clips, which `npm run seed:tts -- --stage <stage>` regenerates.
- Location: `s3://<BACKUP_S3_BUCKET>/daily/<stage>/<stage>-YYYY-MM-DD_HHMM.dump`
  (IST timestamp), kept 30 days. The dump taken on the 1st of each month is
  also copied to `monthly/<stage>/` and kept 365 days. Expiry is done by the
  bucket's lifecycle rules, not by the workflow.
- The bucket is private and versioned; the workflow's IAM role can only
  `PutObject`, so it cannot read, overwrite-away or delete old backups.

Each run also restores the dump into a throwaway Postgres on the runner and
fails (GitHub emails the repo owner) if the restore reports errors or the key
tables come back empty.

## Checking it is working

```bash
gh run list --workflow db-backup.yml --limit 5
aws s3 ls s3://<bucket>/daily/his/ | tail -3
```

GitHub disables scheduled workflows in a public repo after 60 days without any
repository activity (it emails a warning first). If that happens: Actions tab →
DB backup → Enable workflow.

Run one on demand: `gh workflow run db-backup.yml`.

## Restore

Needs PostgreSQL client 17 or newer (`pg_restore --version`). Use the **session
pooler** URI for the target (`postgres.<ref>@aws-1-ap-south-1.pooler.supabase.com:5432`).

```bash
aws s3 ls s3://<bucket>/daily/his/                       # pick a file
aws s3 cp s3://<bucket>/daily/his/his-2026-11-13_0200.dump .
```

### One table / a few rows (the usual case)

Extract to SQL and take what you need — nothing is written to any database:

```bash
pg_restore --data-only --table=party -f party.sql his-2026-11-13_0200.dump
```

Or load the whole dump into a scratch database (local Postgres, or the `dev`
project) and query the old rows from there.

### Whole database into a new/empty Supabase project

```bash
pg_restore --no-owner --clean --if-exists -d "$TARGET_DB_URL" his-2026-11-13_0200.dump
```

Then: point `SUPABASE_URL_<STAGE>` / `SUPABASE_KEY_<STAGE>` /
`SUPABASE_DB_URL_<STAGE>` in `.env` at the new project, `npx sls deploy --stage
<stage>`, `npm run seed:tts -- --stage <stage>`, and update the
`BACKUP_DB_URL_<STAGE>` GitHub secret.

`--clean` drops and recreates every object in `public` on the target. Never run
it against a live database you have not just backed up — his and hmb are two
different clients, so double-check the stage in both the file name and the URL.

## One-time setup (already done if backups are running)

- S3 bucket: private, versioned, lifecycle `daily/` 30 d, `monthly/` 365 d.
- IAM: GitHub OIDC provider + a role trusted only for
  `repo:mDeepanshu/mandi-lambda-core:ref:refs/heads/main`, policy `s3:PutObject`
  on the bucket.
- GitHub repo variables `BACKUP_AWS_ROLE_ARN`, `BACKUP_S3_BUCKET`; secrets
  `BACKUP_DB_URL_HIS`, `BACKUP_DB_URL_HMB` (session-pooler URIs of a read-only
  `backup_ro` database role, member of `pg_read_all_data`).
