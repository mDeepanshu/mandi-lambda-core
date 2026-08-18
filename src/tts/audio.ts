// Minimal WAV surgery, done once at seeding time.
//
// TTS engines pad every clip with a beat of silence at both ends. That is fine
// for a whole sentence, but an announcement plays 6-10 clips back to back, so
// the padding accumulates into an audible stutter between every word. Trimming
// it here (rather than in the browser) means the client can decode and schedule
// the buffers as-is, and the stored files are smaller to preload.

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

/** Read the RIFF chunk table. Returns null if this is not a PCM WAV. */
export function parseWav(buf: Buffer): WavInfo | null {
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return null;

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataLength = 0;

  // chunks start right after the RIFF/WAVE header and are word-aligned
  let cursor = 12;
  while (cursor + 8 <= buf.length) {
    const id = buf.toString('ascii', cursor, cursor + 4);
    const size = buf.readUInt32LE(cursor + 4);
    const body = cursor + 8;

    if (id === 'fmt ' && body + 16 <= buf.length) {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = Math.min(size, buf.length - body);
      break;
    }

    cursor = body + size + (size % 2);
  }

  if (!sampleRate || !channels || !dataOffset) return null;
  return { sampleRate, channels, bitsPerSample, dataOffset, dataLength };
}

export function durationMs(info: WavInfo): number {
  const bytesPerFrame = info.channels * (info.bitsPerSample / 8);
  if (!bytesPerFrame) return 0;
  return Math.round((info.dataLength / bytesPerFrame / info.sampleRate) * 1000);
}

function buildWav(pcm: Buffer, info: WavInfo): Buffer {
  const header = Buffer.alloc(44);
  const bytesPerFrame = info.channels * (info.bitsPerSample / 8);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(info.channels, 22);
  header.writeUInt32LE(info.sampleRate, 24);
  header.writeUInt32LE(info.sampleRate * bytesPerFrame, 28); // byte rate
  header.writeUInt16LE(bytesPerFrame, 32); // block align
  header.writeUInt16LE(info.bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Strip leading/trailing silence from a 16-bit PCM WAV.
 *
 * `padMs` of the original silence is kept at each end so plosives and
 * aspirated consonants ("छ", "ठ") do not get their onset clipped, which is
 * what makes naive zero-crossing trims sound clicky.
 *
 * Anything that is not 16-bit PCM is returned untouched — a slightly padded
 * clip is far better than a corrupted one.
 */
export function trimSilence(buf: Buffer, padMs = 15, thresholdRatio = 0.01): Buffer {
  const info = parseWav(buf);
  if (!info || info.bitsPerSample !== 16) return buf;

  const bytesPerFrame = info.channels * 2;
  const frames = Math.floor(info.dataLength / bytesPerFrame);
  if (frames === 0) return buf;

  const threshold = 32767 * thresholdRatio;

  // peak amplitude across channels for one frame
  const peakAt = (frame: number) => {
    let peak = 0;
    for (let ch = 0; ch < info.channels; ch++) {
      const at = info.dataOffset + frame * bytesPerFrame + ch * 2;
      peak = Math.max(peak, Math.abs(buf.readInt16LE(at)));
    }
    return peak;
  };

  let first = 0;
  while (first < frames && peakAt(first) < threshold) first++;

  // all silence — nothing meaningful to keep
  if (first === frames) return buf;

  let last = frames - 1;
  while (last > first && peakAt(last) < threshold) last--;

  const pad = Math.round((padMs / 1000) * info.sampleRate);
  const from = Math.max(0, first - pad);
  const to = Math.min(frames, last + 1 + pad);

  const pcm = buf.subarray(
    info.dataOffset + from * bytesPerFrame,
    info.dataOffset + to * bytesPerFrame
  );

  return buildWav(pcm, info);
}
