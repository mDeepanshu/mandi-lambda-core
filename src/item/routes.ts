import { createItem, listItems } from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'POST' && path === '/item') {
    return createItem(event);
  }

  if (method === 'GET' && path === '/item/listItems') {
    return listItems(event);
  }

  return {
    statusCode: 404,
    body: JSON.stringify({ message: 'Route not found' }),
  };
}
