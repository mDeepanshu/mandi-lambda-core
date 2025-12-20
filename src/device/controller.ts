import * as service from './service';
import { success, error } from '../common/response.util';
import { DeviceStatus, NewDeviceCreationRequestDTO } from './device.models';

export async function register(event: any) {
  try {
    const body = JSON.parse(event.body || '{}') as NewDeviceCreationRequestDTO;
    const result = await service.registerDevice(body);
    return success(result);
  } catch (e) {
    console.error('register device error:', e);
    return error();
  }
}

export async function listDevices(event: any) {
  try {
    let status = event.queryStringParameters?.status;

    let statusList: DeviceStatus[];

    if (!status) {
      // Same logic as Java: default to all statuses
      statusList = ['REQUESTED', 'REJECTED', 'APPROVED'];
    } else if (Array.isArray(status)) {
      statusList = status as DeviceStatus[];
    } else {
      statusList = status.split(',') as DeviceStatus[];
    }

    const result = await service.listDevices(statusList);
    return success(result);
  } catch (e) {
    console.error('listDevices error:', e);
    return error();
  }
}

export async function updateDeviceStatus(event: any) {
  try {
    const id = Number(event.queryStringParameters?.id);
    const status = event.queryStringParameters?.status as DeviceStatus;

    if (!id || !status) {
      return error('id and status are required', 400);
    }

    const result = await service.updateDeviceStatus(id, status);
    return success(result);
  } catch (e) {
    console.error('updateDeviceStatus error:', e);
    return error();
  }
}
