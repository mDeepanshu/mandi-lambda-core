import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { routeNotFound } from '../common/error';
import {
  createParty,
  updateParty,
  getPartyById,
  listAllParties,
  validatePartyCode,
  vasuliTransaction,
} from './controller';

export async function route(event: APIGatewayProxyEventV2) {
  const { method, path } = event.requestContext.http;

  // POST /party
  if (method === 'POST' && path === '/party') {
    return createParty(event);
  }

  // PATCH /party
  if (method === 'PATCH' && path === '/party') {
    return updateParty(event);
  }

  // GET /party/getPartyById?partyId=123
  if (method === 'GET' && path === '/party/getPartyById') {
    return getPartyById(event);
  }

  // GET /party/listAllParties?partyType=XYZ
  if (method === 'GET' && path === '/party/listAllParties') {
    return listAllParties(event);
  }

  // GET /party/validatePartyCode
  if (method === 'GET' && path === '/party/validatePartyCode') {
    return validatePartyCode(event);
  }

  // POST /party/vasuliTrasaction
  if (method === 'POST' && path === '/party/vasuliTrasaction') {
    return vasuliTransaction(event);
  }

  return routeNotFound();
}
