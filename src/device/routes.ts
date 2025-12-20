import {
  register,
  listDevices,
  updateDeviceStatus,
} from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'POST' && path === '/device/register')
    return register(event);

  if (method === 'GET' && path === '/device/listDevices')
    return listDevices(event);

  if (method === 'PUT' && path.match(/^\/device\/\d+\/status$/))
    return updateDeviceStatus(event);

  return {
    statusCode: 404,
    body: JSON.stringify({ message: 'Route not found' }),
  };
}
