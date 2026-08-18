import * as repo from './party.repo';
import {
  CreatePartyBodySchemaType,
  UpdatePartyBodySchemaType,
  VasuliTransactionBodySchemaType,
} from './validation';

export const createParty = (parties: CreatePartyBodySchemaType) => {
  const mapped = parties.map((party) => ({
    party_id: party.partyId,
    name: party.name,
    contact: party.contact,
    party_type: party.partyType === 'KISAN' ? 0 : 1,
    owed_amount: party.owedAmount,
    max_loan_days: party.maxLoanDays,
    ledger_order: party.ledgerOrder,
    party_code: party.partyCode,
  }));
  return repo.insertParties(mapped);
};

export const updateParty = (party: UpdatePartyBodySchemaType) =>
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
  transactions: VasuliTransactionBodySchemaType,
  confirmDuplicate: boolean
) =>
  repo.vasuliTransaction(transactions, confirmDuplicate);
