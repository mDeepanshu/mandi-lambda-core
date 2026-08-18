/**
 * Populates SUPABASE_URL / SUPABASE_KEY from serverless.ts before anything
 * under src/ is loaded.
 *
 * src/common/supabase.ts reads those two at module-evaluation time, so this
 * has to be the FIRST import in any script that touches the domain modules —
 * imports run in source order, so putting it at the top is what makes the
 * client come up pointed at the right stage.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import serverlessConfiguration from '../serverless';

type SupabaseStageConfig = Record<string, { url: string; key: string }>;

export function argValue(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/** Minimal .env reader — avoids pulling dotenv in for admin scripts. */
function loadDotEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;

    const [, key, raw] = match;
    // a value already in the shell environment wins over .env
    if (process.env[key]) continue;
    process.env[key] = raw.trim().replace(/^["']|["']$/g, '');
  }
}

loadDotEnv();

export const stage = argValue('--stage', 'dev');

const supabaseByStage = (serverlessConfiguration.custom as { supabase: SupabaseStageConfig })
  .supabase;
const credentials = supabaseByStage[stage];

if (!credentials) {
  throw new Error(`Unknown stage "${stage}". Known: ${Object.keys(supabaseByStage).join(', ')}`);
}

process.env.SUPABASE_URL = credentials.url;
process.env.SUPABASE_KEY = credentials.key;
process.env.LOG_LEVEL ??= 'WARN';

export const supabaseUrl = credentials.url;
