import {
  generateBill,
  saveBill,
  kisanBillPaymentSummary,
  PendingItemsSummary,
  PendingByKisanId
} from './controller';

export async function route(event: any) {
  const { method, path } = event.requestContext.http;

  if (method === 'GET' && path === '/kisan/generateBill')
    return generateBill(event);

  if (method === 'POST' && path === '/kisan/saveBill')
    return saveBill(event);

  if (method === 'GET' && path === '/kisan/kisanBillPaymentSummary')
    return kisanBillPaymentSummary(event);

  if (method === 'GET' && path === '/kisan/PendingItemsSummary')
    return PendingItemsSummary(event);

  if (method === 'GET' && path === '/kisan/PendingByKisanId')
    return PendingByKisanId(event);

  return {
    statusCode: 404,
    body: JSON.stringify({ message: 'Route not found' }),
  };
}
