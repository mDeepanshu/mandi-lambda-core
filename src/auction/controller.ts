import * as service from './service';
import { success, error } from '../common/response.util';

export async function postAuction(event: any) {
  try {
    const body = JSON.parse(event.body || '[]');
    const deviceId = event.headers?.deviceid;
    if (!deviceId) return error('deviceId header is required', 400);

    return success(await service.addAuction(body, deviceId));
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function generateLedger(event: any) {
  try {
    const { startDate, endDate } =
      event.queryStringParameters || {};
    return success(await service.generateLedger(startDate, endDate));
  } catch {
    return error();
  }
}

export async function editAuctionTransaction(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    return success(await service.editAuctionTransaction(body));
  } catch {
    return error();
  }
}

export async function listAuctionTransaction(event: any) {
  try {
    let { startDate, endDate, deviceId } =
      event.queryStringParameters || {};
    deviceId = deviceId?.trim() || null;

    return success(
      await service.listAuctionTransaction(
        startDate,
        endDate,
        deviceId
      )
    );
  } catch {
    return error();
  }
}

export async function deleteAuctionTransaction(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    return success(await service.deleteAuctionTransactions(body));
  } catch {
    return error();
  }
}

export async function editAuction(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    const deviceId = event.headers?.deviceid;
    if (!deviceId) return error('deviceId header is required', 400);

    await service.editAuction(body, deviceId);
    return success(null);
  } catch {
    return error();
  }
}

export async function markTransactionValidated(event: any) {
  try {
    const { fromDate, toDate, vyapariId } =
      event.queryStringParameters || {};
    return success(
      await service.markTransactionValidated(
        fromDate,
        toDate,
        vyapariId
      )
    );
  } catch {
    return error();
  }
}
