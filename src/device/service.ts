import * as repo from './device.repo';
import { NewDeviceCreationRequestDTO, DeviceStatus, DeviceDetailsDTO } from './device.models';

// the DeviceDetails entity as the old server serialized it (camelCase)
const toEntity = (d: DeviceDetailsDTO) => ({
  id: d.id,
  name: d.name,
  creationDate: d.creation_date,
  updationTime: d.updation_time,
  status: d.status,
});

export const registerDevice = async (dto: NewDeviceCreationRequestDTO) =>
  toEntity(await repo.insertDevice(dto.name));

export const listDevices = (status: DeviceStatus[]) =>
  repo.fetchDevicesByStatus(status);

export const updateDeviceStatus = async (
  id: number,
  status: DeviceStatus
) =>
  toEntity(await repo.updateDeviceStatus(id, status));
