import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const optionalString = nonEmptyString.optional();
const optionalNumber = z.coerce.number().optional();

const addAuctionTransactionSchema = z
  .object({
    vyapariId: nonEmptyString,
    rate: optionalNumber,
    quantity: optionalNumber,
    bag: optionalNumber,
    bags: optionalNumber,
    chungi: optionalNumber,
    crate_count: optionalNumber,
    bagWiseQuantity: z.array(z.coerce.number()).optional(),
  })
  .passthrough();

export const addAuctionBodySchema = z
  .array(
    z
      .object({
        kisanId: nonEmptyString,
        itemId: optionalString,
        bagTotal: optionalNumber,
        crate_id: optionalNumber,
        buyItems: z.array(addAuctionTransactionSchema).min(1),
        auctionDate: optionalString,
        deviceId: optionalNumber,
      })
      .passthrough()
  )
;

export const deviceIdHeaderSchema = z.object({
  deviceid: nonEmptyString.regex(/^\d+$/, 'deviceId must be a numeric header value'),
});

export const generateLedgerQuerySchema = z.object({
  startDate: nonEmptyString,
  endDate: optionalString,
});

export const listAuctionTransactionQuerySchema = z.object({
  startDate: nonEmptyString,
  endDate: nonEmptyString,
  deviceId: z.string().optional().transform(v => v?.trim() || undefined),
  includeItemTotals: z.enum(['true', 'false']).optional(),
});

export const editAuctionTransactionBodySchema = z
  .object({
    auctionTransactionId: nonEmptyString,
    auctionDate: optionalString,
    vyapariId: nonEmptyString,
    rate: z.coerce.number(),
    quantity: z.coerce.number(),
    bag: z.coerce.number(),
    chungi: z.coerce.number(),
    bagWiseQuantity: z.array(z.coerce.number()).optional(),
  })
  .passthrough();

export const deleteAuctionTransactionBodySchema = z.object({
  auctionTransactionIds: z.array(nonEmptyString).min(1),
});

export const editAuctionBodySchema = z.object({
  deleteAuctionTransactionDto: deleteAuctionTransactionBodySchema,
  addAuctionDtos: addAuctionBodySchema,
});

export const markTransactionValidatedQuerySchema = z.object({
  fromDate: nonEmptyString,
  toDate: nonEmptyString,
  vyapariId: nonEmptyString,
});

