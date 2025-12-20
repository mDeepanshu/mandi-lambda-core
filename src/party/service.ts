import * as repo from './party.repo';

export const createParty = (data: any[]) =>
  repo.insertParties(data);

export const updateParty = (party: any) =>
  repo.updateParty(party);

export const getPartyById = (partyId: string) =>
  repo.fetchPartyById(partyId);

export const listAllParties = (partyType?: string) =>
  repo.fetchAllParties(partyType);

export const validatePartyCode = (
  mobileNumber: string,
  partyCode?: string,
  idNo?: number
) =>
  repo.validatePartyCode(mobileNumber, partyCode, idNo);

export const vasuliTransaction = (
  transactions: any[],
  confirmDuplicate: boolean
) =>
  repo.vasuliTransaction(transactions, confirmDuplicate);
