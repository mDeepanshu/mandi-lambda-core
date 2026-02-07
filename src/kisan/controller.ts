import * as service from './service';
import { success, error } from '../common/response.util';

export async function generateBill(event: any) {
  try {
    const { billId } = event.queryStringParameters || {};
    if (!billId)
      return error('billId is required', 400);

    const result = await service.generateBill(billId);
    return success(result);
  } catch (e: any) {
    console.error(e);
    if (e.message?.includes('Parse'))
      return error('Parse Exception. Maybe Date format is wrong', 400);
    return error();
  }
}

export async function saveBill(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { kisanId, bill_date } = body;

    if (!kisanId || !bill_date)
      return error('kisanId and bill_date are required', 400);

    const result = await service.saveBill(kisanId, bill_date, body);
    return success(result);
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function kisanBillPaymentSummary(event: any) {
  try {
    const { date } =
      event.queryStringParameters || {};

    const result = await service.kisanBillPaymentSummary(
      date
    );

    return success(result);
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function PendingItemsSummary(event: any) {
  try {

    const { startDate, endDate } =
      event.queryStringParameters || {};

    const result = await service.PendingItemsSummary(startDate, endDate);
    return success(result);
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function PendingByKisanId(event: any) {
  try {
    const { kisanId } =
      event.queryStringParameters || {};
    if (!kisanId) return error('kisanId is required', 400);

    const result = await service.PendingByKisanId(kisanId);
    return success(result);
  } catch (e) {
    console.error(e);
    return error();
  }
}