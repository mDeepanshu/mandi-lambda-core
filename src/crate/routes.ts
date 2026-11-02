import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { routeNotFound } from '../common/error';
import { getCrates, createCrate, getCrateSummaryByDate, editCrateSummary, editCrateEntry, getCrateStockReportByDate, getCrateLedger, getCrateVasuliSheet, getCrateVasuliList, editCrateVasuli, getCrateAuctionList, editCrateAuctionEntry, getPendingCrateSummary, getPendingCratesByVyapari, crateReturn, crateIssue } from './controller';


export async function route(event: APIGatewayProxyEventV2) {
  const { method, path } = event.requestContext.http;

  if (method === 'POST' && path === '/crate') {
    return createCrate(event);
  }

  if (method === 'GET' && path === '/crate') {
    return getCrates();
  }

  if (method === 'GET' && path.startsWith('/crate/summary')) {
    return getCrateSummaryByDate(event);
  }

  if (method === 'PUT' && path === '/crate/summary') {
    return editCrateSummary(event);
  }

  if (method === 'GET' && path.startsWith('/crate/stock-report')) {
    return getCrateStockReportByDate(event);
  }

  if (method === 'GET' && path.startsWith('/crate/ledger')) {
    return getCrateLedger(event);
  }

  if (method === 'GET' && path.startsWith('/crate/vasuli-sheet')) {
    return getCrateVasuliSheet(event);
  }

  if (method === 'GET' && path.startsWith('/crate/vasuli-list')) {
    return getCrateVasuliList(event);
  }

  if (method === 'PUT' && path === '/crate/vasuli') {
    return editCrateVasuli(event);
  }

  if (method === 'GET' && path.startsWith('/crate/auction-list')) {
    return getCrateAuctionList(event);
  }

  if (method === 'PUT' && path === '/crate/auction-entry') {
    return editCrateAuctionEntry(event);
  }

  if (method === 'PUT' && path === '/crate/entry') {
    return editCrateEntry(event);
  }

  if (method === 'GET' && path.startsWith('/crate/pending-summary')) {
    return getPendingCrateSummary();
  }

  if (method === 'GET' && path.startsWith('/crate/pending-crates')) {
    return getPendingCratesByVyapari(event);
  }

  if (method === 'POST' && path === '/crate/return') {
    return crateReturn(event);
  }

  if (method === 'POST' && path === '/crate/issue') {
    return crateIssue(event);
  }

  return routeNotFound('Crate route not found');
}
