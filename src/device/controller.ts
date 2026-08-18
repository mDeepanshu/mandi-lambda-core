import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody, validateQuery } from '../common/validation';
import { DeviceStatus } from './device.models';
import {
  listDevicesQuerySchema,
  registerDeviceBodySchema,
  updateDeviceStatusQuerySchema,
} from './validation';

export async function register(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, registerDeviceBodySchema);

    logger.info('Register device', { name: body.name });
    const result = await service.registerDevice(body);
    return success(result);
  } catch (e) {
    return handleError(e, 'Register device error');
  }
}

export async function listDevices(event: APIGatewayProxyEventV2) {
  try {
    const { status } = validateQuery(event, listDevicesQuerySchema);

    let statusList: DeviceStatus[];

    if (!status) {
      statusList = ['REQUESTED', 'REJECTED', 'APPROVED'];
    } else if (Array.isArray(status)) {
      statusList = status as DeviceStatus[];
    } else {
      statusList = status.split(',') as DeviceStatus[];
    }

    logger.info('List devices', { statusList });
    const result = await service.listDevices(statusList);
    return success(result);
  } catch (e) {
    return handleError(e, 'List devices error');
  }
}

export async function updateDeviceStatus(event: APIGatewayProxyEventV2) {
  try {
    const pathParts = event.requestContext.http.path.split('/');
    const id = parseInt(pathParts[2], 10);
    const { status } = validateQuery(event, updateDeviceStatusQuerySchema);

    logger.info('Update device status', { id, status });
    const result = await service.updateDeviceStatus(id, status);
    return success(result);
  } catch (e) {
    return handleError(e, 'Update device status error');
  }
}
