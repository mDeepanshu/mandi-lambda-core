import * as c from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'GET' && path === '/vyapari/generateBill') return c.generateBill(event);
  if (method === 'GET' && path === '/vyapari/ledger') return c.generateLedger(event);
  if (method === 'POST' && path === '/vyapari/ledger-list') return c.ledgerList(event);
  if (method === 'GET' && path === '/vyapari/ledger-list-all-vyapari') return c.ledgerListAll(event);
  if (method === 'GET' && path === '/vyapari/vasuli-list') return c.vasuliList(event);
  if (method === 'PUT' && path === '/vyapari/edit-vasuli') return c.editVasuli(event);
  if (method === 'GET' && path === '/vyapari/pending-vasuli') return c.pendingVasuli(event);
  if (method === 'POST' && path === '/vyapari/notify-vasuli') return c.notifyVasuli(event);

  return { statusCode: 404, body: 'Route not found' };
}
