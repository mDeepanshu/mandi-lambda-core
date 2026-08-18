import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody, validateQuery } from '../common/validation';
import {
  generateBillQuerySchema,
  kisanBillPaymentSummaryQuerySchema,
  markPendingAsSoldQuerySchema,
  pendingByKisanIdQuerySchema,
  pendingItemsSummaryQuerySchema,
  saveBillBodySchema,
} from './validation';

export async function generateBill(event: APIGatewayProxyEventV2) {
  try {
    const { billId } = validateQuery(event, generateBillQuerySchema);

    logger.info('Generate kisan bill', { billId });
    const result = await service.generateBill(billId);
    return success(result);
  } catch (e: any) {
    return handleError(e, 'Generate kisan bill error');
  }
}

export async function saveBill(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, saveBillBodySchema);
    const { kisanId, bill_date } = body;

    logger.info('Save kisan bill', { kisanId, billDate: bill_date });
    const result = await service.saveBill(kisanId, bill_date, body);
    return success(result);
  } catch (e) {
    return handleError(e, 'Save kisan bill error');
  }
}

export async function kisanBillPaymentSummary(event: APIGatewayProxyEventV2) {
  try {
    const { date } = validateQuery(event, kisanBillPaymentSummaryQuerySchema);

    logger.info('Kisan bill payment summary', { date });
    const result = await service.kisanBillPaymentSummary(date);
    return success(result);
  } catch (e) {
    return handleError(e, 'Kisan bill payment summary error');
  }
}

export async function PendingItemsSummary(event: APIGatewayProxyEventV2) {
  try {
    const { startDate, endDate } = validateQuery(event, pendingItemsSummaryQuerySchema);

    logger.info('Pending items summary', { startDate, endDate });
    const result = await service.PendingItemsSummary(startDate, endDate);
    return success(result);
  } catch (e) {
    return handleError(e, 'Pending items summary error');
  }
}

export async function PendingByKisanId(event: APIGatewayProxyEventV2) {
  try {
    const { kisanId } = validateQuery(event, pendingByKisanIdQuerySchema);

    logger.info('Pending by kisan id', { kisanId });
    const result = await service.PendingByKisanId(kisanId);
    return success(result);
  } catch (e) {
    return handleError(e, 'Pending by kisan id error');
  }
}

export async function markPendingAsSold(event: APIGatewayProxyEventV2) {
  try {
    const { pendingId } = validateQuery(event, markPendingAsSoldQuerySchema);

    logger.info('Mark pending as sold', { pendingId });
    const result = await service.markPendingAsSold(pendingId);
    return success(result);
  } catch (e) {
    return handleError(e, 'Mark pending as sold error');
  }
}
