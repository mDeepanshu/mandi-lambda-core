export interface NewDeviceCreationRequestDTO {
  name: string;
}

/**
 * Matches DeviceDetails.Status enum in Java
 * Update values if your enum differs
 */
export type DeviceStatus =
  | 'REQUESTED'
  | 'REJECTED'
  | 'APPROVED';
