import * as service from './service';
import { success, error } from '../common/response.util';

export async function generateBill(event: any) {
  try {
    const { kisanId, date } = event.queryStringParameters || {};
    if (!kisanId || !date)
      return error('kisanId and date are required', 400);

    const result = await service.generateBill(kisanId, date);
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
    const { kisanId, date } = event.queryStringParameters || {};
    if (!kisanId || !date)
      return error('kisanId and date are required', 400);

    const body = JSON.parse(event.body || '{}');
    const result = await service.saveBill(kisanId, date, body);
    return success(result);
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function kisanBillPaymentSummary(event: any) {
  try {
    const { startDate, endDate, listLive } =
      event.queryStringParameters || {};

    const result = await service.kisanBillPaymentSummary(
      startDate,
      endDate,
      listLive === 'true'
    );

    return success(result);
  } catch (e) {
    console.error(e);
    return error();
  }
}
