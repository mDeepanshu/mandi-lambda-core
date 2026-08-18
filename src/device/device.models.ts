export interface NewDeviceCreationRequestDTO {
  name: string;
}

export type DeviceStatus = 'REQUESTED' | 'REJECTED' | 'APPROVED' | 'DELETED';

export interface DeviceDetailsDTO {
  id: number;
  creation_date: string;
  name: string | null;
  status: DeviceStatus;
  updation_time: string | null;
}
