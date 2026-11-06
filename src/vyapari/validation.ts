import { z } from 'zod';
import { optionalAmount } from '../party/validation';

const nonEmptyString = z.string().trim().min(1);

export const generateBillQuerySchema = z.object({
  vyapariId: nonEmptyString,
  date: nonEmptyString,
});

export const ledgerQuerySchema = z.object({
  vyapariId: nonEmptyString,
  startDate: nonEmptyString,
  endDate: nonEmptyString,
});

export const ledgerListBodySchema = z.array(nonEmptyString).min(1);
export type LedgerListBodySchemaType = z.infer<typeof ledgerListBodySchema>;

export const dateRangeQuerySchema = z.object({
  startDate: nonEmptyString,
  endDate: nonEmptyString,
});

// Forwarded to legacy_edit_vasuli, which applies the old server's rules: a key
// that is present is written as sent ("" / null amount = pending again), an
// absent one keeps its value. The frontends send amounts as text.
export const editVasuliBodySchema = z
  .object({
    id: nonEmptyString,
    amount: optionalAmount,
    vyapariId: z.string().nullish(),
    remark: z.string().nullish(),
    date: z.string().nullish(),
  })
  .passthrough();
export type EditVasuliBodySchemaType = z.infer<typeof editVasuliBodySchema>;

// the old server bound a missing showToday as false
export const pendingVasuliQuerySchema = z.object({
  showToday: z.enum(['true', 'false']).optional(),
});

// NotifyVasuliDto. vyapariId is missing on the vasuli-list screen's call; the
// old server then updated no party.
export const notifyVasuliBodySchema = z
  .object({
    vyapariId: z.string().nullish(),
    name: z.string().nullish(),
    contact: z.string().nullish(),
    message: z.union([z.string(), z.number()]).nullish(),
    date: z.string().nullish(),
    remark: z.string().nullish(),
    idNo: z.union([z.string(), z.number()]).nullish(),
    templateName: z.string().nullish(),
  })
  .passthrough();
export type NotifyVasuliBodySchemaType = z.infer<typeof notifyVasuliBodySchema>;
