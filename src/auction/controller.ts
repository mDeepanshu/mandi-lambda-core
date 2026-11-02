import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody, validateHeaders, validateQuery } from '../common/validation';
import {
  addAuctionBodySchema,
  deleteAuctionTransactionBodySchema,
  deviceIdHeaderSchema,
  editAuctionBodySchema,
  editAuctionTransactionBodySchema,
  generateLedgerQuerySchema,
  listAuctionTransactionQuerySchema,
  markTransactionValidatedQuerySchema,
} from './validation';

export async function postAuction(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, addAuctionBodySchema);
    if (body.length === 0) return success(null);
    const { deviceid } = validateHeaders(event, deviceIdHeaderSchema);

    logger.info('Post auction', { count: body.length, deviceId: deviceid });
    return success(await service.addAuction(body, deviceid));
  } catch (e) {
    return handleError(e, 'Post auction error');
  }
}

export async function generateLedger(event: APIGatewayProxyEventV2) {
  try {
    const { startDate, endDate } = validateQuery(event, generateLedgerQuerySchema);

    logger.info('Generate auction ledger', { startDate, endDate });
    return success(await service.generateLedger(startDate, endDate));
  } catch (e) {
    return handleError(e, 'Generate auction ledger error');
  }
}

export async function editAuctionTransaction(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, editAuctionTransactionBodySchema);

    logger.info('Edit auction transaction', { auctionTransactionId: body.auctionTransactionId });
    return success(await service.editAuctionTransaction(body));
  } catch (e) {
    return handleError(e, 'Edit auction transaction error');
  }
}

export async function listAuctionTransaction(event: APIGatewayProxyEventV2) {
  try {
    const { startDate, endDate, deviceId, includeItemTotals } = validateQuery(
      event,
      listAuctionTransactionQuerySchema
    );

    logger.info('List auction transactions', { startDate, endDate, deviceId, includeItemTotals });
    return success(
      await service.listAuctionTransaction(
        startDate,
        endDate,
        deviceId?.trim() || null,
        includeItemTotals === 'true'
      )
    );
  } catch (e) {
    return handleError(e, 'List auction transaction error');
  }
}

export async function deleteAuctionTransaction(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, deleteAuctionTransactionBodySchema);

    logger.info('Delete auction transactions', { count: body.auctionTransactionIds.length });
    return success(await service.deleteAuctionTransactions(body));
  } catch (e) {
    return handleError(e, 'Delete auction transaction error');
  }
}

export async function editAuction(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, editAuctionBodySchema);
    validateHeaders(event, deviceIdHeaderSchema);

    logger.info('Edit auction', { deleteCount: body.deleteAuctionTransactionDto.auctionTransactionIds.length, addCount: body.addAuctionDtos.length });
    await service.editAuction(body);
    return success(null);
  } catch (e) {
    return handleError(e, 'Edit auction error');
  }
}

export async function markTransactionValidated(event: APIGatewayProxyEventV2) {
  try {
    const { fromDate, toDate, vyapariId } = validateQuery(
      event,
      markTransactionValidatedQuerySchema
    );

    logger.info('Mark transactions validated', { fromDate, toDate, vyapariId });
    return success(
      await service.markTransactionValidated(
        fromDate,
        toDate,
        vyapariId
      )
    );
  } catch (e) {
    return handleError(e, 'Mark transaction validated error');
  }
}
