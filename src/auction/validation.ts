import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const optionalString = nonEmptyString.optional();
// nullish so an explicit null stays null — coercion would turn it into 0, i.e.
// bag 0 instead of no bag count, and device 0 instead of the header's device
const optionalNumber = z.coerce.number().nullish();

// Client-made ids (auction app): optional while older callers still post
// without them; the DB generates ids for those, as before.
const optionalUuid = z.uuid().optional();

const addAuctionTransactionSchema = z
  .object({
    auctionTransactionId: optionalUuid,
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
        auctionId: optionalUuid,
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
    newAuctionTransactionId: optionalUuid,
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

// bulk=true validates every auto_ledger party (the "send all ledgers" button);
// otherwise one vyapari. Neither given is a no-op, as on the old server.
export const markTransactionValidatedQuerySchema = z.object({
  fromDate: nonEmptyString,
  toDate: nonEmptyString,
  vyapariId: optionalString,
  bulk: z.enum(['true', 'false']).optional(),
});

