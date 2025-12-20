import * as service from './service';
import { success, error } from '../common/response.util';

export async function saveKisanBill(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    return success(await service.saveKisanBill(body));
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function getKisanBill(event: any) {
  try {
    const { kisanId, billDate, index = '0' } =
      event.queryStringParameters || {};

    return success(
      await service.getKisanBillByKisanIdAndDate(
        kisanId,
        billDate,
        Number(index)
      )
    );
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function saveVyapariBill(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    return success(await service.saveVyapariBill(body));
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function getVyapariBill(event: any) {
  try {
    const { vyapariId, billDate, index = '0' } =
      event.queryStringParameters || {};

    return success(
      await service.getVyapariBillByVyapariIdAndDate(
        vyapariId,
        billDate,
        Number(index)
      )
    );
  } catch (e) {
    console.error(e);
    return error();
  }
}

export async function autoSaveBills() {
  try {
    await service.autoSaveBills();
    return success(null);
  } catch (e) {
    console.error(e);
    return error();
  }
}
