import * as c from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'POST' && path === '/auction') return c.postAuction(event);
  if (method === 'GET' && path === '/auction/generate-ledger') return c.generateLedger(event);
  if (method === 'POST' && path === '/auction/edit-auction-transaction') return c.editAuctionTransaction(event);
  if (method === 'GET' && path === '/auction/list-auction-transaction') return c.listAuctionTransaction(event);
  if (method === 'DELETE' && path === '/auction/delete-auction-transaction') return c.deleteAuctionTransaction(event);
  if (method === 'PATCH' && path === '/auction/edit-auction') return c.editAuction(event);
  if (method === 'PATCH' && path === '/auction/mark-transaction-validated') return c.markTransactionValidated(event);

  return { statusCode: 404, body: 'Route not found' };
}
