import { log } from 'console';
import { supabase } from '../common/supabase';

//partyCode is missing
export async function insertParties(parties: any[]) {
  const { data, error } = await supabase
    .from('party')
    .insert(parties)
    .select();

  if (error) throw error;
  return data;
}

export async function updateParty(party: any) {
  log('Updating party:', party);
  const { data, error } = await supabase
    .from('party')
    .update(party)
    .eq('party_id', party.party_id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchPartyById(partyId: string) {
  const { data, error } = await supabase
    .from('party')
    .select('*')
    .eq('party_id', partyId)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchAllParties(partyType?: string) {

  const { data, error } = await supabase.rpc('get_all_parties', {
    party_type_param: partyType === 'KISAN' ? '0' : '1'
  });
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
    .eq('contact', mobileNumber);

  if (partyCode) query = query.eq('party_code', partyCode);
  if (idNo) query = query.eq('id_no', idNo);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

//not checked
export async function vasuliTransaction(
  transactions: any[],
  confirmDuplicate: boolean
) {
  // placeholder — implement exact logic from Java later
  console.log(transactions);
  if (!transactions.length) {
    return null;
  }

  const { data, error } = await supabase.rpc('insert_vasuli', {
    p_amount: transactions[0].amount,
    p_date: transactions[0].date,
    p_vyapari_id: transactions[0].vyapariId,
    p_remark: transactions[0].remark,
    p_was_null: transactions[0].was_null
  });


  console.log(data);


  if (error && !confirmDuplicate) throw error;
  return data;
}
