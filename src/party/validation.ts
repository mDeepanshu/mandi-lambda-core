import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const optionalString = nonEmptyString.optional();
const optionalNumber = z.coerce.number().optional();

const partyCreateSchema = z
  .object({
    party_id: optionalString,
    partyId: optionalString,
    name: nonEmptyString,
    contact: nonEmptyString,
    party_type: optionalString,
    partyType: optionalString,
    owed_amount: optionalNumber,
    owedAmount: optionalNumber,
    max_loan_days: optionalNumber,
    maxLoanDays: optionalNumber,
    ledger_order: optionalNumber,
    ledgerOrder: optionalNumber,
    party_code: optionalString,
    partyCode: optionalString,
  })
  .passthrough()
  .refine((party) => party.party_type || party.partyType, {
    path: ['party_type'],
    message: 'party_type is required',
  });

export const createPartyBodySchema = z.array(partyCreateSchema).min(1);

export const updatePartyBodySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    contact: nonEmptyString,
    maxLoanDays: optionalNumber,
    ledgerOrder: optionalNumber,
    lastNotifiedAmount: optionalNumber,
    partyCode: optionalString,
  })
  .passthrough();

export const getPartyByIdQuerySchema = z.object({
  partyId: nonEmptyString,
});

export const listAllPartiesQuerySchema = z.object({
  partyType: z.enum(['KISAN', 'VYAPARI']).optional(),
});

export const validatePartyCodeQuerySchema = z.object({
  mobileNumber: nonEmptyString,
  partyCode: optionalString,
  idNo: optionalNumber,
});

export const vasuliTransactionBodySchema = z
  .array(
    z
      .object({
        vyapariId: nonEmptyString,
        date: nonEmptyString,
        amount: z.coerce.number(),
        remark: optionalString,
        was_null: z.coerce.boolean().optional(),
      })
      .passthrough()
  )
;

export const vasuliTransactionQuerySchema = z.object({
  confirmDuplicate: z.enum(['true', 'false']).optional(),
});

export type CreatePartyBodySchemaType = z.infer<typeof createPartyBodySchema>;
export type UpdatePartyBodySchemaType = z.infer<typeof updatePartyBodySchema>;
export type VasuliTransactionBodySchemaType = z.infer<typeof vasuliTransactionBodySchema>;

