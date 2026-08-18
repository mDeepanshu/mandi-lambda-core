import { routeNotFound } from '../common/error';
import { ensureClips, getManifest } from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'GET' && path === '/tts/manifest') {
    return getManifest(event);
  }

  if (method === 'POST' && path === '/tts/clips') {
    return ensureClips(event);
  }

  return routeNotFound();
}
