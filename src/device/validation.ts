import { z } from 'zod';

// DeviceDetails.Status — mandi-auction lists REJECTED,DELETED devices
const deviceStatusSchema = z.enum(['REQUESTED', 'REJECTED', 'APPROVED', 'DELETED']);

export const registerDeviceBodySchema = z.object({
  name: z.string().trim().min(1),
});

export const listDevicesQuerySchema = z.object({
  status: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => value.split(',').every((s) => deviceStatusSchema.safeParse(s).success),
      'status must contain REQUESTED, REJECTED, APPROVED or DELETED'
    )
    .optional(),
});

export const updateDeviceStatusQuerySchema = z.object({
  status: deviceStatusSchema,
});

export type RegisterDeviceBodySchemaType = z.infer<typeof registerDeviceBodySchema>;
export type ListDevicesQuerySchemaType = z.infer<typeof listDevicesQuerySchema>;
export type UpdateDeviceStatusQuerySchemaType = z.infer<typeof updateDeviceStatusQuerySchema>;
