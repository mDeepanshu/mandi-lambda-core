import { supabase } from '../common/supabase';

export async function insertParties(parties: any[]) {
  const { data, error } = await supabase
    .from('party')
    .insert(parties)
    .select();

  if (error) throw error;
  return data;
}

export async function updateParty(party: any) {
  const { data, error } = await supabase
    .from('party')
    .update(party)
    .eq('id', party.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchPartyById(partyId: string) {
  const { data, error } = await supabase
    .from('party')
    .select('*')
    .eq('id', partyId)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchAllParties(partyType?: string) {
  let query = supabase.from('party').select('*');
  if (partyType) query = query.eq('party_type', partyType);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function validatePartyCode(
  mobileNumber: string,
  partyCode?: string,
  idNo?: number
) {
  let query = supabase
    .from('party')
    .select('*')
    .eq('mobile_number', mobileNumber);

  if (partyCode) query = query.eq('party_code', partyCode);
  if (idNo) query = query.eq('id_no', idNo);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function vasuliTransaction(
  transactions: any[],
  confirmDuplicate: boolean
) {
  // placeholder — implement exact logic from Java later
  const { data, error } = await supabase
    .from('vasuli_transaction')
    .insert(transactions)
    .select();

  if (error && !confirmDuplicate) throw error;
  return data;
}
