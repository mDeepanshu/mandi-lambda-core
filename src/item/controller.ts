import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { AddItemRequestDTO } from './items.models';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody } from '../common/validation';
import { createItemBodySchema } from './validation';

export async function createItem(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, createItemBodySchema) as AddItemRequestDTO[];

    logger.info('Create items', { count: body.length });
    const result = await service.createItems(body);
    // 200, not 201: the item masters treat only responseCode 200 as saved
    return success(result);
  } catch (e) {
    return handleError(e, 'Create item error');
  }
}

export async function listItems(_event: APIGatewayProxyEventV2) {
  try {
    logger.info('List items');
    const result = await service.listItems();
    return success(result);
  } catch (e) {
    return handleError(e, 'List items error');
  }
}
