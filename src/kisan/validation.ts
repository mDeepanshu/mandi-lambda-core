import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const optionalString = nonEmptyString.optional();
const optionalNumber = z.coerce.number().optional();

// Treats "" / null as "not provided" so blank optional numeric fields
// don't reach Postgres as empty strings (which fail ::numeric casts).
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema);

const optionalMoney = emptyToUndefined(z.coerce.number().optional());
// Required numeric that still rejects "" / null with a clear message.
const requiredMoney = emptyToUndefined(
  z.coerce.number({ error: 'mandi_kharcha is required' })
);

export const generateBillQuerySchema = z.object({
  billId: nonEmptyString,
});

export const saveBillBodySchema = z
  .object({
    kisanId: nonEmptyString,
    bill_date: nonEmptyString,
    billId: optionalNumber,
    mandi_kharcha: requiredMoney,
    hammali: optionalMoney,
    nagar_palika_tax: optionalMoney,
    nagar_palika_tax_rate: optionalMoney,
    bhada: optionalMoney,
    bhada_rate: optionalMoney,
    driver_inaam: optionalMoney,
    nagdi: optionalMoney,
    commission: optionalMoney,
    commission_rate: optionalMoney,
    kharcha_total: optionalMoney,
    kaccha_total: optionalMoney,
    pakki_bikri: optionalMoney,
    kisan_name: optionalString,
  })
  .passthrough();

export const kisanBillPaymentSummaryQuerySchema = z.object({
  date: nonEmptyString,
});

export const pendingItemsSummaryQuerySchema = z.object({
  startDate: optionalString,
  endDate: optionalString,
});

export const pendingByKisanIdQuerySchema = z.object({
  kisanId: nonEmptyString,
});

export const markPendingAsSoldQuerySchema = z.object({
  pendingId: nonEmptyString,
});
