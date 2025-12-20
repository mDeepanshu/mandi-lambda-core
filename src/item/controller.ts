import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { AddItemRequestDTO } from './items.models';
import { success, error } from '../common/response.util';

export async function createItem(
  event: APIGatewayProxyEventV2
) {
  try {
    const body = JSON.parse(event.body || '[]') as AddItemRequestDTO[];
    const result = await service.createItems(body);
    return success(result, true);
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function listItems(
  _event: APIGatewayProxyEventV2
) {
  try {
    const result = await service.listItems();
    return success(result);
  } catch (e) {
    console.error(e);
    return error();
  }
}
