import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const createCrateBodySchema = z
  .object({
    crateName: nonEmptyString,
    total: z.coerce.number(),
    closingAmount: z.coerce.number(),
  })
  .passthrough();

export const crateDateQuerySchema = z.object({
  p_date: dateString,
});

export const crateLedgerQuerySchema = z.object({
  p_from_date: dateString,
  p_to_date: dateString,
  p_vyapari_id: nonEmptyString,
});

export const pendingCratesQuerySchema = z.object({
  p_vyapari_id: nonEmptyString,
});

export const crateReturnBodySchema = z
  .object({
    vyapariId: nonEmptyString,
    date: dateString,
    crates: z
      .array(
        z.object({
          crate_id: z.coerce.number().int().positive(),
          count: z.coerce.number().int().positive(),
        })
      )
      .min(1),
  })
  .passthrough();

export const crateIssueBodySchema = crateReturnBodySchema;

export const editCrateSummaryBodySchema = z
  .object({
    vyapariId: nonEmptyString,
    date: dateString,
    crates: z
      .array(
        z.object({
          crate_id: z.coerce.number().int().positive(),
          // absolute final total for this crate on this date; replaces the
          // crate's manual entries with one, 0 removes them
          count: z.coerce.number().int().min(0),
        })
      )
      .min(1)
      .refine(
        (crates) => new Set(crates.map((c) => c.crate_id)).size === crates.length,
        'crate_id must be unique'
      ),
  })
  .passthrough();

export const editCrateVasuliBodySchema = editCrateSummaryBodySchema
  .extend({
    // present only when reassigning the entry to a different vyapari
    newVyapariId: nonEmptyString.optional(),
    // re-sent as true after the client confirms the 409 merge preview
    confirmMerge: z.coerce.boolean().optional(),
  })
  .refine(
    (b) => b.newVyapariId !== b.vyapariId,
    { message: 'newVyapariId must differ from vyapariId', path: ['newVyapariId'] }
  )
  .refine(
    (b) => !b.confirmMerge || !!b.newVyapariId,
    { message: 'confirmMerge is only valid with newVyapariId', path: ['confirmMerge'] }
  );

export const editCrateAuctionEntryBodySchema = z
  .object({
    id: z.coerce.number().int().positive(),
    crate_id: z.coerce.number().int().positive(),
    // absolute new count for this entry; 0 deletes it
    count: z.coerce.number().int().min(0),
  })
  .passthrough();

// same shape, but for any entry (manual or auction, issue or return)
export const editCrateEntryBodySchema = editCrateAuctionEntryBodySchema;

