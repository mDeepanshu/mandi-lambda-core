import { createHash } from 'node:crypto';
import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { TtsClipRow } from './tts.models';

export const TTS_BUCKET = 'tts';

const SELECT_COLUMNS = 'token, voice, lang, storage_path, duration_ms, sample_rate, byte_size';

/**
 * Storage key for a clip. Hashed rather than using the Hindi text directly —
 * Devanagari in an object key survives neither URL encoding nor CDN caching
 * cleanly, and the token itself is already in the manifest row.
 */
export function storagePathFor(token: string, voice: string, lang: string): string {
  const hash = createHash('sha1').update(`${lang}|${voice}|${token}`).digest('hex');
  return `${lang}/${voice}/${hash}.wav`;
}

export function publicUrlFor(storagePath: string): string {
  const { data } = supabase.storage.from(TTS_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function fetchClips(voice: string, lang: string): Promise<TtsClipRow[]> {
  logger.debug('Table: tts_clip select', { voice, lang });

  const { data, error } = await supabase
    .from('tts_clip')
    .select(SELECT_COLUMNS)
    .eq('voice', voice)
    .eq('lang', lang)
    .order('token');

  if (error) throw error;
  return (data ?? []) as TtsClipRow[];
}

export async function fetchClipsByTokens(
  tokens: string[],
  voice: string,
  lang: string
): Promise<TtsClipRow[]> {
  if (!tokens.length) return [];

  logger.debug('Table: tts_clip select by token', { count: tokens.length, voice, lang });

  const { data, error } = await supabase
    .from('tts_clip')
    .select(SELECT_COLUMNS)
    .eq('voice', voice)
    .eq('lang', lang)
    .in('token', tokens);

  if (error) throw error;
  return (data ?? []) as TtsClipRow[];
}

/**
 * Upload the WAV bytes. `upsert` so re-running the seed script after a voice
 * change overwrites in place and every already-cached manifest URL stays valid.
 */
export async function uploadClipAudio(storagePath: string, audio: Buffer): Promise<void> {
  logger.debug('Storage: tts upload', { storagePath, bytes: audio.length });

  const { error } = await supabase.storage
    .from(TTS_BUCKET)
    .upload(storagePath, audio, {
      contentType: 'audio/wav',
      upsert: true,
      cacheControl: '31536000',
    });

  if (error) throw error;
}

export async function upsertClip(row: TtsClipRow): Promise<TtsClipRow> {
  logger.debug('Table: tts_clip upsert', { token: row.token, voice: row.voice });

  const { data, error } = await supabase
    .from('tts_clip')
    .upsert(row, { onConflict: 'token,voice,lang' })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw error;
  return data as TtsClipRow;
}
