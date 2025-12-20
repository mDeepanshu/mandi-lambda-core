import * as service from './service';
import { success, error } from '../common/response.util';

export async function createParty(event: any) {
  try {
    const body = JSON.parse(event.body || '[]');
    const result = await service.createParty(body);
    return success(result, true); // 201 CREATED
  } catch (e) {
    console.error('createParty error:', e);
    return error();
  }
}

export async function updateParty(event: any) {
  try {
    const body = JSON.parse(event.body || '{}');
    const result = await service.updateParty(body);
    return success(result);
  } catch (e) {
    console.error('updateParty error:', e);
    return error();
  }
}

export async function getPartyById(event: any) {
  try {
    const partyId = event.queryStringParameters?.partyId;

    if (!partyId) {
      return error(
        'partyId is required',
        400
      );
    }

    const result = await service.getPartyById(partyId);
    return success(result);
  } catch (e) {
    console.error('getPartyById error:', e);
    return error();
  }
}

export async function listAllParties(event: any) {
  try {
    const partyType = event.queryStringParameters?.partyType;
    const result = await service.listAllParties(partyType);
    return success(result);
  } catch (e) {
    console.error('listAllParties error:', e);
    return error();
  }
}

export async function validatePartyCode(event: any) {
  try {
    const { mobileNumber, partyCode, idNo } =
      event.queryStringParameters || {};

    if (!mobileNumber) {
      return error(
        'mobileNumber is required',
        400
      );
    }

    const result = await service.validatePartyCode(
      mobileNumber,
      partyCode,
      idNo ? Number(idNo) : undefined
    );

    return success(result);
  } catch (e) {
    console.error('validatePartyCode error:', e);
    return error();
  }
}

export async function vasuliTransaction(event: any) {
  try {
    const body = JSON.parse(event.body || '[]');
    const confirmDuplicate =
      event.queryStringParameters?.confirmDuplicate === 'true';

    const result = await service.vasuliTransaction(
      body,
      confirmDuplicate
    );

    return success(result);
  } catch (e) {
    console.error('vasuliTransaction error:', e);
    return error();
  }
}
