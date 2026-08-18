/**
 * Render the whole TTS clip alphabet once, so announcements never call the
 * provider at runtime.
 *
 *   npm run seed:tts -- --stage dev
 *   npm run seed:tts -- --stage hmb --force     # re-render (e.g. voice change)
 *
 * Needs SARVAM_API_KEY in the shell or in .env. Supabase credentials come from
 * serverless.ts so this can never drift from what the Lambdas use.
 *
 * Idempotent: already-seeded tokens are skipped unless --force is passed, and
 * both the upload and the manifest row upsert in place, so re-running after a
 * partial failure just fills the gaps.
 */
// must stay first — it points the supabase client at the requested stage
import { argValue, stage } from './bootstrap-env';
import { sleep } from '../src/tts/sarvam';
import { renderClip } from '../src/tts/service';
import { buildAlphabet } from '../src/tts/tokens';
import { fetchClips } from '../src/tts/tts.repo';

async function main() {
  const voice = argValue('--voice', 'aditya');
  const lang = argValue('--lang', 'hi-IN');
  const force = process.argv.includes('--force');
  // Sarvam rate-limits a back-to-back run of the full alphabet. synthesize()
  // retries 429s with backoff, but pacing the requests avoids burning those
  // retries in the first place. Raise with --delay if the limit tightens.
  const delayMs = Number(argValue('--delay', '400'));

  if (!process.env.SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY is not set (shell env or .env)');
  }

  const alphabet = buildAlphabet();
  const existing = new Set(force ? [] : (await fetchClips(voice, lang)).map((row) => row.token));
  const pending = alphabet.filter((token) => !existing.has(token));

  console.log(`stage=${stage} voice=${voice} lang=${lang}`);
  console.log(`alphabet=${alphabet.length} cached=${existing.size} to render=${pending.length}`);

  let done = 0;
  const failed: string[] = [];

  for (const [index, token] of pending.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    try {
      const row = await renderClip(token, voice, lang);
      done++;
      console.log(`  [${done}/${pending.length}] ${token} — ${row.duration_ms}ms, ${row.byte_size}B`);
    } catch (e) {
      failed.push(token);
      console.error(`  [!] ${token} — ${(e as Error).message}`);
    }
  }

  console.log(`\nrendered=${done} failed=${failed.length} total=${alphabet.length}`);

  if (failed.length) {
    console.error(`failed tokens: ${failed.join(', ')}`);
    console.error('re-run the same command to retry only these');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
