import { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as service from './service';
import { handleError } from '../common/error';
import { logger } from '../common/logger';
import { success } from '../common/response.util';
import { validateBody, validateQuery } from '../common/validation';
import {
  crateDateQuerySchema,
  crateIssueBodySchema,
  crateLedgerQuerySchema,
  crateReturnBodySchema,
  createCrateBodySchema,
  editCrateAuctionEntryBodySchema,
  editCrateEntryBodySchema,
  editCrateSummaryBodySchema,
  editCrateVasuliBodySchema,
  pendingCratesQuerySchema,
} from './validation';

export async function createCrate(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, createCrateBodySchema);
    const { crateName, total, closingAmount } = body;

    logger.info('Create crate', { crateName, total });
    const data = await service.createCrate(crateName, total, closingAmount);
    return success(data);
  } catch (err) {
    return handleError(err, 'Create crate error');
  }
}

export async function getCrates() {
  try {
    logger.info('Get crates');
    const data = await service.getCrates();
    return success(data);
  } catch (err) {
    return handleError(err, 'Get crates error');
  }
}

export async function getCrateSummaryByDate(event: APIGatewayProxyEventV2) {
  try {
    const { p_date } = validateQuery(event, crateDateQuerySchema);

    logger.info('Get crate summary', { date: p_date });
    const data = await service.getCrateSummaryByDate(p_date);
    return success(data);
  } catch (err) {
    return handleError(err, 'Get crate summary by date error');
  }
}

export async function editCrateSummary(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, editCrateSummaryBodySchema);

    logger.info('Edit crate summary', { vyapariId: body.vyapariId, date: body.date, crateCount: body.crates.length });
    const data = await service.editCrateSummary(body);
    return success(data);
  } catch (err) {
    return handleError(err, 'Edit crate summary error');
  }
}

export async function editCrateEntry(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, editCrateEntryBodySchema);

    logger.info('Edit crate entry', { id: body.id, crateId: body.crate_id, count: body.count });
    const data = await service.editCrateEntry(body);
    return success(data);
  } catch (err) {
    return handleError(err, 'Edit crate entry error');
  }
}

export async function getCrateStockReportByDate(event: APIGatewayProxyEventV2) {
  try {
    const { p_date } = validateQuery(event, crateDateQuerySchema);

    logger.info('Get crate stock report', { date: p_date });
    const data = await service.getCrateStockReportByDate(p_date);
    return success(data);
  } catch (err) {
    return handleError(err, 'Get crate stock report by date error');
  }
}

export async function getCrateLedger(event: APIGatewayProxyEventV2) {
  try {
    const { p_from_date, p_to_date, p_vyapari_id } = validateQuery(event, crateLedgerQuerySchema);

    logger.info('Get crate ledger', { fromDate: p_from_date, toDate: p_to_date, vyapariId: p_vyapari_id });
    const data = await service.getCrateLedger(p_from_date, p_to_date, p_vyapari_id);
    return success(data);
  } catch (err) {
    return handleError(err, 'Get crate ledger error');
  }
}

export async function getCrateVasuliSheet(event: APIGatewayProxyEventV2) {
  try {
    const { p_date } = validateQuery(event, crateDateQuerySchema);

    logger.info('Get crate vasuli sheet', { date: p_date });
    const data = await service.getCrateVasuliSheet(p_date);
    return success(data);
  } catch (err) {
    return handleError(err, 'Get crate vasuli sheet error');
  }
}

export async function getCrateVasuliList(event: APIGatewayProxyEventV2) {
  try {
    const { p_date } = validateQuery(event, crateDateQuerySchema);

    logger.info('Get crate vasuli list', { date: p_date });
    const data = await service.getCrateVasuliList(p_date);
    return success(data);
  } catch (err) {
    return handleError(err, 'Get crate vasuli list error');
  }
}

export async function editCrateVasuli(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, editCrateVasuliBodySchema);

    logger.info('Edit crate vasuli', { vyapariId: body.vyapariId, newVyapariId: body.newVyapariId, confirmMerge: body.confirmMerge, date: body.date, crateCount: body.crates.length });
    const data = await service.editCrateVasuli(body);
    return success(data);
  } catch (err) {
    return handleError(err, 'Edit crate vasuli error');
  }
}

export async function getCrateAuctionList(event: APIGatewayProxyEventV2) {
  try {
    const { p_date } = validateQuery(event, crateDateQuerySchema);

    logger.info('Get crate auction list', { date: p_date });
    const data = await service.getCrateAuctionList(p_date);
    return success(data);
  } catch (err) {
    return handleError(err, 'Get crate auction list error');
  }
}

export async function editCrateAuctionEntry(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, editCrateAuctionEntryBodySchema);

    logger.info('Edit crate auction entry', { id: body.id, crateId: body.crate_id, count: body.count });
    const data = await service.editCrateAuctionEntry(body);
    return success(data);
  } catch (err) {
    return handleError(err, 'Edit crate auction entry error');
  }
}

export async function getPendingCrateSummary() {
  try {
    logger.info('Get pending crate summary');
    const data = await service.getPendingCrateSummary();
    return success(data);
  } catch (err) {
    return handleError(err, 'Get pending crate summary error');
  }
}

export async function getPendingCratesByVyapari(event: APIGatewayProxyEventV2) {
  try {
    const { p_vyapari_id } = validateQuery(event, pendingCratesQuerySchema);

    logger.info('Get pending crates by vyapari', { vyapariId: p_vyapari_id });
    const data = await service.getPendingCratesByVyapari(p_vyapari_id);
    return success(data);
  } catch (err) {
    return handleError(err, 'Get pending crates by vyapari error');
  }
}

export async function crateIssue(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, crateIssueBodySchema);

    logger.info('Crate issue', { vyapariId: body.vyapariId, crateCount: body.crates.length });
    const data = await service.crateIssue(body);
    return success(data);
  } catch (err) {
    return handleError(err, 'Crate issue error');
  }
}

export async function crateReturn(event: APIGatewayProxyEventV2) {
  try {
    const body = validateBody(event, crateReturnBodySchema);

    logger.info('Crate return', { vyapariId: body.vyapariId, crateCount: body.crates.length });
    const data = await service.crateReturn(body);
    return success(data);
  } catch (err) {
    return handleError(err, 'Crate return error');
  }
}
