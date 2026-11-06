import { routeNotFound } from '../common/error';
import { createItem, listItems } from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  // the frontends add items with POST to the API root, as on the old server
  if (method === 'POST' && (path === '/' || path === '/item/createItem' || path === '/createItem')) {
    return createItem(event);
  }

  if (method === 'GET' && (path === '/item/listItems' || path === '/listItems')) {
    return listItems(event);
  }

  return routeNotFound();
}
