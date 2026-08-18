import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { routeNotFound } from '../common/error';
import { register, listDevices, updateDeviceStatus } from './controller';

export async function route(event: APIGatewayProxyEventV2) {
  const { method, path } = event.requestContext.http;

  if (method === 'POST' && path === '/device/register')
    return register(event);

  if (method === 'GET' && path === '/device/listDevices')
    return listDevices(event);

  if (method === 'PUT' && /^\/device\/\d+\/status$/.test(path))
    return updateDeviceStatus(event);

  return routeNotFound();
}
