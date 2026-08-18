import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import {
  UpdatePartyBodySchemaType,
  VasuliTransactionBodySchemaType,
} from './validation';
import { InsertPartyDTO } from './party.models';

export async function insertParties(parties: InsertPartyDTO[]) {
  logger.debug('Table: party insert', { count: parties.length });
  const { data, error } = await supabase
    .from('party')
    .insert(parties)
    .select();

  if (error) throw error;
  return data;
}

export async function updateParty(party: UpdatePartyBodySchemaType) {
  const modiParty = {
    contact: party.contact,
    name: party.name,
    max_loan_days: party.maxLoanDays,
    ledger_order: party.ledgerOrder,
    last_notified_amount: party.lastNotifiedAmount,
    party_code: party.partyCode,
  };

  logger.debug('Table: party update', { partyId: party.id });
  const { data, error } = await supabase
    .from('party')
    .update(modiParty)
    .eq('party_id', party.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchPartyById(partyId: string) {
  logger.debug('Table: party select by id', { partyId });
  const { data, error } = await supabase
    .from('party')
    .select('*')
    .eq('party_id', partyId)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchAllParties(partyType?: string) {
  const partyTypeParam =
    partyType === 'KISAN' ? 0 : partyType === 'VYAPARI' ? 1 : null;

  logger.debug('RPC: get_all_parties', { partyType });
  const { data, error } = await supabase.rpc('get_all_parties', {
    party_type_param: partyTypeParam,
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

//not checked
export async function vasuliTransaction(
  transactions: VasuliTransactionBodySchemaType,
  confirmDuplicate: boolean
) {
  if (!transactions.length) {
    return null;
  }

  // Atomic in the RPC: inserts every payment and decrements each vyapari's
  // owed_amount. Returns [{ id, vyapariId, amount }] for the caller to map
  // payments to their generated vasuli ids.
  const p_payload = transactions.map((t) => ({
    vyapariId: t.vyapariId,
    date: t.date,
    amount: t.amount,
    remark: t.remark,
    was_null: t.was_null,
  }));

  logger.debug('RPC: insert_vasuli_bulk', { count: p_payload.length });
  const { data, error } = await supabase.rpc('insert_vasuli_bulk', { p_payload });

  if (error && !confirmDuplicate) throw error;
  return data;
}
