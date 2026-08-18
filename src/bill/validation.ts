import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const billPayloadSchema = z.record(z.string(), z.unknown()).refine(
  (payload) => Object.keys(payload).length > 0,
  'body must be a non-empty JSON object'
);

export const saveKisanBillBodySchema = billPayloadSchema;

export const getKisanBillQuerySchema = z.object({
  kisanId: nonEmptyString,
  billDate: nonEmptyString,
  index: z.coerce.number().int().nonnegative().optional(),
});

export const saveVyapariBillBodySchema = billPayloadSchema;

export const getVyapariBillQuerySchema = z.object({
  vyapariId: nonEmptyString,
  billDate: nonEmptyString,
  index: z.coerce.number().int().nonnegative().optional(),
});

