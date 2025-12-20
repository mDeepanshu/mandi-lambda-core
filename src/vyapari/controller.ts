import * as service from './service';
import { success, error } from '../common/response.util';

export async function generateBill(event: any) {
  try {
    const { vyapariId, date } = event.queryStringParameters || {};
    if (!vyapariId || !date)
      return error('vyapariId and date are required', 400);

    return success(await service.generateBill(vyapariId, date));
  } catch (e: any) {
    if (e.message?.includes('Parse'))
      return error('Parse Exception. Maybe Date format is wrong', 400);
    return error();
  }
}

export async function generateLedger(event: any) {
  try {
    const { vyapariId, startDate, endDate } =
      event.queryStringParameters || {};
    const vyapariCode = event.headers?.vyaparicode;
    const filter = !!vyapariCode;

    const ledger = await service.generateLedger(
      vyapariId,
      startDate,
      endDate,
      filter
    );

    if (filter) ledger.openingAmount = null;
    return success(ledger);
  } catch {
    return error();
  }
}

export async function ledgerList(event: any) {
  try {
    const { startDate, endDate } = event.queryStringParameters || {};
    const ids = JSON.parse(event.body || '[]');
    return success(await service.getLedgerList(ids, startDate, endDate));
  } catch {
    return error();
  }
}

export async function ledgerListAll(event: any) {
  try {
    const { startDate, endDate } = event.queryStringParameters || {};
    return success(await service.listAllVyapariLedger(startDate, endDate));
  } catch {
    return error();
  }
}

export async function vasuliList(event: any) {
  try {
    const { startDate, endDate } = event.queryStringParameters || {};
    const list = await service.getVasuliList(startDate, endDate);
    return success({ vasuliList: list });
  } catch {
    return error();
  }
}

export async function editVasuli(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    return success(await service.editVasuli(body));
  } catch {
    return error();
  }
}

export async function pendingVasuli(event: any) {
  try {
    const showToday =
      event.queryStringParameters?.showToday === 'true';
    return success(await service.getPendingVasuli(showToday));
  } catch {
    return error();
  }
}

export async function notifyVasuli(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    return success(await service.notifyVasuli(body));
  } catch {
    return error();
  }
}
