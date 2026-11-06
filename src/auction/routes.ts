import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handleError, routeNotFound } from '../common/error';
import * as c from './controller';
import { requireApprovedDevice } from './device-guard';

export async function route(event: APIGatewayProxyEventV2) {
  const { method, path } = event.requestContext.http;

  try {
    await requireApprovedDevice(event);
  } catch (e) {
    return handleError(e, 'Auction device check error');
  }

  if (method === 'POST' && path === '/auction') return c.postAuction(event);
  if (method === 'GET' && path === '/auction/generate-ledger') return c.generateLedger(event);
  if (method === 'POST' && path === '/auction/edit-auction-transaction') return c.editAuctionTransaction(event);
  if (method === 'GET' && path === '/auction/list-auction-transaction') return c.listAuctionTransaction(event);
  if (method === 'DELETE' && path === '/auction/delete-auction-transaction') return c.deleteAuctionTransaction(event);
  if (method === 'PATCH' && path === '/auction/edit-auction') return c.editAuction(event);
  if (method === 'PATCH' && path === '/auction/mark-transaction-validated') return c.markTransactionValidated(event);

  return routeNotFound();
}
