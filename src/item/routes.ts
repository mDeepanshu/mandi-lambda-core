import { routeNotFound } from '../common/error';
import { createItem, listItems } from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'POST' && path === '/item/createItem') {
    return createItem(event);
  }

  if (method === 'GET' && (path === '/item/listItems' || path === '/listItems')) {
    return listItems(event);
  }

  return routeNotFound();
}
