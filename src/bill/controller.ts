import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody, validateQuery } from '../common/validation';
import {
  getKisanBillQuerySchema,
  getVyapariBillQuerySchema,
  saveKisanBillBodySchema,
  saveVyapariBillBodySchema,
} from './validation';

export async function saveKisanBill(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, saveKisanBillBodySchema);

    logger.info('Save kisan bill', { kisanId: body.kisan_id });
    return success(await service.saveKisanBill(body));
  } catch (e) {
    return handleError(e, 'Save kisan bill snapshot error');
  }
}

export async function getKisanBill(event: APIGatewayProxyEventV2) {
  try {
    const { kisanId, billDate, index = 0 } = validateQuery(event, getKisanBillQuerySchema);

    logger.info('Get kisan bill', { kisanId, billDate, index });
    return success(
      await service.getKisanBillByKisanIdAndDate(
        kisanId,
        billDate,
        index
      )
    );
  } catch (e) {
    return handleError(e, 'Get kisan bill snapshot error');
  }
}

export async function saveVyapariBill(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, saveVyapariBillBodySchema);

    logger.info('Save vyapari bill', { vyapariId: body.vyapari_id });
    return success(await service.saveVyapariBill(body));
  } catch (e) {
    return handleError(e, 'Save vyapari bill snapshot error');
  }
}

export async function getVyapariBill(event: APIGatewayProxyEventV2) {
  try {
    const { vyapariId, billDate, index = 0 } = validateQuery(event, getVyapariBillQuerySchema);

    logger.info('Get vyapari bill', { vyapariId, billDate, index });
    return success(
      await service.getVyapariBillByVyapariIdAndDate(
        vyapariId,
        billDate,
        index
      )
    );
  } catch (e) {
    return handleError(e, 'Get vyapari bill snapshot error');
  }
}

export async function autoSaveBills() {
  try {
    logger.info('Auto save bills');
    await service.autoSaveBills();
    return success(null);
  } catch (e) {
    return handleError(e, 'Auto save bills error');
  }
}
