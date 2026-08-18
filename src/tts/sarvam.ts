import { AppError } from '../common/error';
import { logger } from '../common/logger';
import { ResponseCodes } from '../common/response';

// Sarvam is the only place a clip is ever rendered. It is hit by the seed
// script (once, for the whole alphabet) and by the on-demand fallback for a
// token nobody thought to seed — never on a normal announcement.

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';

export const DEFAULT_VOICE = 'aditya';
export const DEFAULT_LANG = 'hi-IN';
export const DEFAULT_MODEL = 'bulbul:v3';
export const DEFAULT_SAMPLE_RATE = 22050;

export interface SynthesizeOptions {
  text: string;
  voice?: string;
  lang?: string;
  apiKey?: string;
}

export function hasSarvamKey(): boolean {
  return Boolean(process.env.SARVAM_API_KEY);
}

const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 30_000;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Honour Retry-After when the provider sends it, else exponential + jitter. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }

  const base = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * 250);
}

/** Render one token to WAV bytes. Throws AppError on any provider failure. */
export async function synthesize({
  text,
  voice = DEFAULT_VOICE,
  lang = DEFAULT_LANG,
  apiKey = process.env.SARVAM_API_KEY,
}: SynthesizeOptions): Promise<Buffer> {
  if (!apiKey) {
    throw new AppError(
      'TTS provider is not configured',
      ResponseCodes.SERVICE_UNAVAILABLE,
      undefined,
      false
    );
  }

  const body = JSON.stringify({
    text,
    target_language_code: lang,
    model: DEFAULT_MODEL,
    speaker: voice,
    pace: 1.05,
    speech_sample_rate: DEFAULT_SAMPLE_RATE,
  });

  let res: Response | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(SARVAM_TTS_URL, {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (res.ok) break;

    // 429 is expected when seeding the whole alphabet back to back, and a 5xx
    // from the provider is usually transient — both are worth waiting out
    // rather than failing the token and forcing a manual re-run
    const retryable = res.status === 429 || res.status >= 500;

    if (!retryable || attempt === MAX_ATTEMPTS) break;

    const wait = backoffMs(attempt, res.headers.get('retry-after'));
    logger.warn('Sarvam TTS retrying', { status: res.status, attempt, waitMs: wait, text });
    await sleep(wait);
  }

  if (!res || !res.ok) {
    const status = res?.status;
    const detail = res ? await res.text().catch(() => '') : '';
    logger.error('Sarvam TTS request failed', undefined, { status, detail, text });
    throw new AppError(
      status === 429 ? 'TTS provider rate limit exceeded' : 'TTS provider request failed',
      ResponseCodes.BAD_GATEWAY,
      undefined,
      false
    );
  }

  const payload = (await res.json()) as { audios?: string[] };
  const audio = payload.audios?.[0];

  if (!audio) {
    throw new AppError(
      'TTS provider returned no audio',
      ResponseCodes.BAD_GATEWAY,
      undefined,
      false
    );
  }

  return Buffer.from(audio, 'base64');
}
