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

  // party_id: party.id,
  // id_no: party.id_no,
  // owed_amount: party.owed_amount,
  // party_type: party.partyType,
  // last_vasuli_date: party.last_vasuli_date,
  // kisan_type: party.kisanType
  const modiParty = {
    contact: party.contact,
    name: party.name,
    max_loan_days: party.maxLoanDays,
    ledger_order: party.ledgerOrder,
    last_notified_amount: party.lastNotifiedAmount,
    party_code: party.partyCode,
  };

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
