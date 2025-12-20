import * as repo from './device.repo';
import { NewDeviceCreationRequestDTO, DeviceStatus } from './device.models';

export const registerDevice = (dto: NewDeviceCreationRequestDTO) =>
  repo.insertDevice(dto.name);

export const listDevices = (status: DeviceStatus[]) =>
  repo.fetchDevicesByStatus(status);

export const updateDeviceStatus = (
  id: number,
  status: DeviceStatus
) =>
  repo.updateDeviceStatus(id, status);
