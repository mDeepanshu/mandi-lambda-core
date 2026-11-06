import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const optionalString = nonEmptyString.optional();
const optionalNumber = z.coerce.number().optional();

// The frontends send every party field as typed text ("", "3", "true"); the
// legacy_* functions parse them the way the old server's Jackson did, so only
// what Jackson itself rejected (a 400 then) is rejected here: numbers that are
// not numbers. Names and contacts are taken as sent, like before.
const numeric = z.union([z.number(), z.string().trim().regex(/^(-?\d+(\.\d+)?)?$/, 'must be numeric')]).nullish();
const partyFields = {
  owedAmount: numeric,
  maxLoanDays: numeric,
  ledgerOrder: numeric,
  commission: numeric,
};

// PartyType.valueOf: exactly KISAN or VYAPARI (anything else was a 500)
export const createPartyBodySchema = z
  .array(z.object({ partyId: nonEmptyString, partyType: z.enum(['KISAN', 'VYAPARI']), ...partyFields }).passthrough())
  .min(1);

// a single object (not an array); id is checked by legacy_update_party, which
// answers a missing one the old way ({code: 400} inside an HTTP 200)
export const updatePartyBodySchema = z.object(partyFields).passthrough();

export const getPartyByIdQuerySchema = z.object({
  partyId: nonEmptyString,
});

export const listAllPartiesQuerySchema = z.object({
  partyType: z
    .string()
    .transform((v) => v.toUpperCase())
    .pipe(z.enum(['KISAN', 'VYAPARI']))
    .optional(),
});

export const validatePartyCodeQuerySchema = z.object({
  mobileNumber: nonEmptyString,
  partyCode: optionalString,
  idNo: optionalNumber,
});

// a money value as the frontends send it: number, numeric text, or ""/null for
// none. Anything else was a Jackson BigDecimal parse error — a 400 — before.
export const optionalAmount = z
  .union([z.number(), z.string().trim().regex(/^(-?\d+(\.\d+)?)?$/, 'amount must be numeric')])
  .nullish();

// amount may be null (the ledger's VASULI button asks for a payment without
// one) and remark may be "" — both are everyday payloads from mandi-auction and
// from the old server's mirror
export const vasuliTransactionBodySchema = z.array(
  z
    .object({
      vyapariId: nonEmptyString,
      date: z.string().nullish(),
      amount: optionalAmount,
      remark: z.string().nullish(),
    })
    .passthrough()
);

export const vasuliTransactionQuerySchema = z.object({
  confirmDuplicate: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['true', 'false']))
    .optional(),
});

export type CreatePartyBodySchemaType = z.infer<typeof createPartyBodySchema>;
export type UpdatePartyBodySchemaType = z.infer<typeof updatePartyBodySchema>;
export type VasuliTransactionBodySchemaType = z.infer<typeof vasuliTransactionBodySchema>;
