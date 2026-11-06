import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { conflict, notFound } from '../common/error';
import {
  CreatePartyBodySchemaType,
  UpdatePartyBodySchemaType,
  VasuliTransactionBodySchemaType,
} from './validation';
import { LegacyResult } from './party.models';

// The legacy_* functions (db/legacy_parity_api.sql) reproduce the old Spring
// server's party endpoints exactly; see that file for the per-field rules.

export async function createParties(parties: CreatePartyBodySchemaType) {
  logger.debug('RPC: legacy_create_parties', { count: parties.length });
  const { data, error } = await supabase.rpc('legacy_create_parties', { p_payload: parties });
  if (error) {
    if (error.code === '23505') throw conflict('A party with this partyId already exists');
    throw error;
  }
  return data;
}

export async function updateParty(party: UpdatePartyBodySchemaType): Promise<LegacyResult> {
  logger.debug('RPC: legacy_update_party', { partyId: party.id });
  const { data, error } = await supabase.rpc('legacy_update_party', { p: party });
  if (error) throw error;
  return data as LegacyResult;
}

export async function fetchPartyById(partyId: string) {
  logger.debug('RPC: legacy_party_entity', { partyId });
  const { data, error } = await supabase.rpc('legacy_party_entity', { p_party_id: partyId });
  if (error) throw error;
  if (data == null) throw notFound(`Party ${partyId} not found`);
  return data;
}

export async function fetchAllParties(partyType?: 'KISAN' | 'VYAPARI') {
  logger.debug('RPC: legacy_list_parties', { partyType });
  const { data, error } = await supabase.rpc('legacy_list_parties', {
    p_party_type: partyType === 'KISAN' ? 0 : partyType === 'VYAPARI' ? 1 : null,
  });
  if (error) throw error;
  return data;
}

export async function validatePartyCode(
  mobileNumber: string,
  partyCode?: string,
  idNo?: number
) {
  logger.debug('Table: party select by contact', { mobileNumber });
  let query = supabase
    .from('party')
    .select('*')
    .eq('contact', mobileNumber);

  if (partyCode) query = query.eq('party_code', partyCode);
  if (idNo) query = query.eq('id_no', idNo);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Atomic in the RPC: the duplicate check, every insert and each vyapari's
// owed_amount. {code: 400, body: warning} when an unconfirmed duplicate stops
// it, else {code: 200, body: [{ id, vyapariId, amount }]} in request order.
export async function insertVasulies(
  transactions: VasuliTransactionBodySchemaType,
  confirmDuplicate: boolean
): Promise<LegacyResult> {
  logger.debug('RPC: legacy_insert_vasulies', { count: transactions.length, confirmDuplicate });
  const { data, error } = await supabase.rpc('legacy_insert_vasulies', {
    p_payload: transactions,
    p_confirm_duplicate: confirmDuplicate,
  });
  if (error) throw error;
  return data as LegacyResult;
}
