import { logger } from '../common/logger';
import { durationMs, parseWav, trimSilence } from './audio';
import { DEFAULT_LANG, DEFAULT_VOICE, synthesize } from './sarvam';
import * as repo from './tts.repo';
import { TtsClipDTO, TtsClipRow, TtsManifestResponseDTO } from './tts.models';

function toDTO(row: TtsClipRow): TtsClipDTO {
  return {
    token: row.token,
    url: repo.publicUrlFor(row.storage_path),
    durationMs: row.duration_ms,
    byteSize: row.byte_size,
  };
}

export async function getManifest(
  voice = DEFAULT_VOICE,
  lang = DEFAULT_LANG
): Promise<TtsManifestResponseDTO> {
  const rows = await repo.fetchClips(voice, lang);
  return { voice, lang, count: rows.length, clips: rows.map(toDTO) };
}

/**
 * Render, trim and store a single token, overwriting any existing clip.
 * Only reached on a cache miss, or from the seed script's `--force` path.
 */
export async function renderClip(
  token: string,
  voice = DEFAULT_VOICE,
  lang = DEFAULT_LANG
): Promise<TtsClipRow> {
  logger.info('Rendering TTS clip', { token, voice, lang });

  const audio = trimSilence(await synthesize({ text: token, voice, lang }));
  const info = parseWav(audio);
  const storagePath = repo.storagePathFor(token, voice, lang);

  await repo.uploadClipAudio(storagePath, audio);

  return repo.upsertClip({
    token,
    voice,
    lang,
    storage_path: storagePath,
    duration_ms: info ? durationMs(info) : null,
    sample_rate: info?.sampleRate ?? null,
    byte_size: audio.length,
  });
}

/**
 * Return clips for `tokens`, rendering any that are missing.
 *
 * This is the self-healing path: a phrase the seed script never covered costs
 * one slow announcement instead of a silent failure, and is permanent from
 * then on. Rendering is sequential on purpose — the provider rate-limits, and
 * a miss is meant to be rare.
 */
export async function ensureClips(
  tokens: string[],
  voice = DEFAULT_VOICE,
  lang = DEFAULT_LANG
): Promise<TtsClipDTO[]> {
  const wanted = [...new Set(tokens)];
  const existing = await repo.fetchClipsByTokens(wanted, voice, lang);
  const byToken = new Map(existing.map((row) => [row.token, row]));

  const missing = wanted.filter((token) => !byToken.has(token));
  if (missing.length) {
    logger.info('TTS cache miss', { count: missing.length, tokens: missing });
  }

  for (const token of missing) {
    byToken.set(token, await renderClip(token, voice, lang));
  }

  // preserve the caller's token order so the client can play straight through
  return wanted.map((token) => toDTO(byToken.get(token)!));
}
