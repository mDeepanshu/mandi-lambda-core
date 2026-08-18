import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const optionalString = nonEmptyString.optional();

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

// Covers all optional fields supported by the edit_vasuli RPC
export const editVasuliBodySchema = z.object({
  id: nonEmptyString,
  amount: z.coerce.number().optional(),
  date: optionalString,
  vyapariId: optionalString,
  remark: optionalString,
  wasNull: z.boolean().optional(),
});
export type EditVasuliBodySchemaType = z.infer<typeof editVasuliBodySchema>;

export const pendingVasuliQuerySchema = z.object({
  showToday: z.enum(['true', 'false']).optional(),
});

// notify_vasuli RPC requires vyapari_id_param + amount_param;
// remaining fields are optional notification-template data
export const notifyVasuliBodySchema = z
  .object({
    vyapari_id_param: nonEmptyString,
    amount_param: z.coerce.number(),
    name: optionalString,
    contact: optionalString,
    message: optionalString,
    date: optionalString,
    remark: optionalString,
    idNo: optionalString,
    templateName: optionalString,
  })
  .passthrough();
export type NotifyVasuliBodySchemaType = z.infer<typeof notifyVasuliBodySchema>;
