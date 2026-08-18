import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody, validateQuery } from '../common/validation';
import {
  createPartyBodySchema,
  getPartyByIdQuerySchema,
  listAllPartiesQuerySchema,
  updatePartyBodySchema,
  validatePartyCodeQuerySchema,
  vasuliTransactionBodySchema,
  vasuliTransactionQuerySchema,
} from './validation';

export async function createParty(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, createPartyBodySchema);

    logger.info('Create party', { count: body.length });
    const result = await service.createParty(body);
    return success(result, true); // 201 CREATED
  } catch (e) {
    return handleError(e, 'Create party error');
  }
}

export async function updateParty(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, updatePartyBodySchema);

    logger.info('Update party', { id: body.id });
    const result = await service.updateParty(body);
    return success(result);
  } catch (e) {
    return handleError(e, 'Update party error');
  }
}

export async function getPartyById(event: APIGatewayProxyEventV2) {
  try {
    const { partyId } = validateQuery(event, getPartyByIdQuerySchema);

    logger.info('Get party by id', { partyId });
    const result = await service.getPartyById(partyId);
    return success(result);
  } catch (e) {
    return handleError(e, 'Get party by id error');
  }
}

export async function listAllParties(event: APIGatewayProxyEventV2) {
  try {
    const { partyType } = validateQuery(event, listAllPartiesQuerySchema);

    logger.info('List all parties', { partyType });
    const result = await service.listAllParties(partyType);
    return success(result);
  } catch (e) {
    return handleError(e, 'List all parties error');
  }
}

export async function validatePartyCode(event: APIGatewayProxyEventV2) {
  try {
    const { mobileNumber, partyCode, idNo } = validateQuery(
      event,
      validatePartyCodeQuerySchema
    );

    logger.info('Validate party code', { mobileNumber, idNo });
    const result = await service.validatePartyCode(
      mobileNumber,
      partyCode,
      idNo
    );

    return success(result);
  } catch (e) {
    return handleError(e, 'Validate party code error');
  }
}

export async function vasuliTransaction(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, vasuliTransactionBodySchema);
    const { confirmDuplicate } = validateQuery(event, vasuliTransactionQuerySchema);

    logger.info('Vasuli transaction', { count: body.length });
    const result = await service.vasuliTransaction(
      body,
      confirmDuplicate === 'true'
    );

    return success(result);
  } catch (e) {
    return handleError(e, 'Vasuli transaction error');
  }
}
