import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

export const ttsManifestQuerySchema = z.object({
  voice: nonEmptyString.optional(),
  lang: nonEmptyString.optional(),
});

export const ensureClipsBodySchema = z
  .object({
    // capped because every miss in the list is a sequential provider call —
    // a legitimate announcement is ~10 tokens, and the alphabet is ~115
    tokens: z.array(nonEmptyString.max(120)).min(1).max(150),
    voice: nonEmptyString.optional(),
    lang: nonEmptyString.optional(),
  })
  .passthrough();
