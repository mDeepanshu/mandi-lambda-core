import { routeNotFound } from '../common/error';
import * as c from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'POST' && path === '/bills/kisan-bill')
    return c.saveKisanBill(event);

  if (method === 'GET' && path === '/bills/kisan-bill')
    return c.getKisanBill(event);

  // the frontends call the old server's root path; /bills/... kept for callers of the lambda's own
  if (method === 'POST' && (path === '/vyapari-bill' || path === '/bills/vyapari-bill'))
    return c.saveVyapariBill(event);

  if (method === 'GET' && (path === '/vyapari-bill' || path === '/bills/vyapari-bill'))
    return c.getVyapariBill(event);

  if (method === 'PATCH' && path === '/bills/autoSaveBills')
    return c.autoSaveBills();

  return routeNotFound();
}
