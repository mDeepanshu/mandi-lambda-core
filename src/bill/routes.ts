import * as c from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'POST' && path === '/bills/kisan-bill')
    return c.saveKisanBill(event);

  if (method === 'GET' && path === '/bills/kisan-bill')
    return c.getKisanBill(event);

  if (method === 'POST' && path === '/bills/vyapari-bill')
    return c.saveVyapariBill(event);

  if (method === 'GET' && path === '/bills/vyapari-bill')
    return c.getVyapariBill(event);

  if (method === 'PATCH' && path === '/bills/autoSaveBills')
    return c.autoSaveBills();

  return { statusCode: 404, body: 'Route not found' };
}
