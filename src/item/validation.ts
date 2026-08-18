import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

export const createItemBodySchema = z
  .array(
    z
      .object({
        itemId: nonEmptyString.optional(),
        name: nonEmptyString,
      })
      .passthrough()
  )
  .min(1);

