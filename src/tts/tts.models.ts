export interface TtsClipRow {
  token: string;
  voice: string;
  lang: string;
  storage_path: string;
  duration_ms: number | null;
  sample_rate: number | null;
  byte_size: number | null;
}

/** One playable clip as the client sees it. */
export interface TtsClipDTO {
  token: string;
  url: string;
  durationMs: number | null;
  byteSize: number | null;
}

export interface TtsManifestResponseDTO {
  voice: string;
  lang: string;
  count: number;
  clips: TtsClipDTO[];
}
