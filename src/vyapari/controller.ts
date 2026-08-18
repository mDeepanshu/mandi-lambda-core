import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody, validateQuery } from '../common/validation';
import {
  dateRangeQuerySchema,
  editVasuliBodySchema,
  generateBillQuerySchema,
  ledgerListBodySchema,
  ledgerQuerySchema,
  notifyVasuliBodySchema,
  pendingVasuliQuerySchema,
} from './validation';

export async function generateBill(event: APIGatewayProxyEventV2) {
  try {
    const { vyapariId, date } = validateQuery(event, generateBillQuerySchema);

    logger.info('Generate vyapari bill', { vyapariId, date });
    return success(await service.generateBill(vyapariId, date));
  } catch (e) {
    return handleError(e, 'Generate vyapari bill error');
  }
}

export async function generateLedger(event: APIGatewayProxyEventV2) {
  try {
    const { vyapariId, startDate, endDate } = validateQuery(event, ledgerQuerySchema);
    const vyapariCode = event.headers?.vyaparicode;
    const filter = !!vyapariCode;

    logger.info('Generate vyapari ledger', { vyapariId, startDate, endDate });
    const ledger = await service.generateLedger(
      vyapariId,
      startDate,
      endDate,
      filter
    );

    if (filter) ledger.openingAmount = null;
    return success(ledger);
  } catch (e) {
    return handleError(e, 'Generate vyapari ledger error');
  }
}

export async function ledgerList(event: APIGatewayProxyEventV2) {
  try {
    const { startDate, endDate } = validateQuery(event, dateRangeQuerySchema);
    const ids = validateBody(event, ledgerListBodySchema);

    logger.info('Vyapari ledger list', { startDate, endDate, count: ids.length });
    return success(await service.getLedgerList(ids, startDate, endDate));
  } catch (e) {
    return handleError(e, 'Vyapari ledger list error');
  }
}

export async function ledgerListAll(event: APIGatewayProxyEventV2) {
  try {
    const { startDate, endDate } = validateQuery(event, dateRangeQuerySchema);

    logger.info('Vyapari ledger list all', { startDate, endDate });
    return success(await service.listAllVyapariLedger(startDate, endDate));
  } catch (e) {
    return handleError(e, 'Vyapari ledger list all error');
  }
}

export async function vasuliList(event: APIGatewayProxyEventV2) {
  try {
    const { startDate, endDate } = validateQuery(event, dateRangeQuerySchema);

    logger.info('Vasuli list', { startDate, endDate });
    const list = await service.getVasuliList(startDate, endDate);
    return success(list);
  } catch (e) {
    return handleError(e, 'Vyapari vasuli list error');
  }
}

export async function editVasuli(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, editVasuliBodySchema);

    logger.info('Edit vasuli', { id: body.id });
    return success(await service.editVasuli(body));
  } catch (e) {
    return handleError(e, 'Edit vasuli error');
  }
}

export async function pendingVasuli(event: APIGatewayProxyEventV2) {
  try {
    const { showToday } = validateQuery(event, pendingVasuliQuerySchema);

    logger.info('Pending vasuli', { showToday });
    return success(await service.getPendingVasuli(showToday === 'true'));
  } catch (e) {
    return handleError(e, 'Pending vasuli error');
  }
}

export async function notifyVasuli(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, notifyVasuliBodySchema);

    logger.info('Notify vasuli', { vyapariId: body.vyapari_id_param });
    return success(await service.notifyVasuli(body));
  } catch (e) {
    return handleError(e, 'Notify vasuli error');
  }
}
