import * as repo from './party.repo';
import { auditOwed } from '../common/owed-audit';
import {
  CreatePartyBodySchemaType,
  UpdatePartyBodySchemaType,
  VasuliTransactionBodySchemaType,
} from './validation';

export const createParty = (parties: CreatePartyBodySchemaType) =>
  auditOwed('party create', parties.map((p) => p.partyId), () => repo.createParties(parties));

// hmb's edit can set owed_amount
export const updateParty = (party: UpdatePartyBodySchemaType) =>
  auditOwed('party edit', [party.id as string | undefined], () => repo.updateParty(party));

export const getPartyById = (partyId: string) =>
  repo.fetchPartyById(partyId);

export const listAllParties = (partyType?: 'KISAN' | 'VYAPARI') =>
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
  auditOwed('vasuli insert', transactions.map((t) => t.vyapariId), () =>
    repo.insertVasulies(transactions, confirmDuplicate)
  );
