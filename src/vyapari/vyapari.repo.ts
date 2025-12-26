import { supabase } from '../common/supabase';
import { NotifyVasuliDto } from './vyapari.models';

export async function generateBill(vyapariId: string, date: string) {
  const { data, error } = await supabase
    .rpc('generate_vyapari_bill', { vyapari_id: vyapariId, bill_date: date });

  if (error) throw error;
  return data;
}

export async function generateLedger(
  vyapariId: string,
  startDate: string,
  endDate: string,
  filterOutNonValidated: boolean
) {
  const { data, error } = await supabase.rpc('generate_vyapari_ledger', {
    vyapari_id: vyapariId,
    start_date: startDate,
    end_date: endDate,
    filter_out_non_validated: filterOutNonValidated,
  });

  if (error) throw error;
  return data;
}

export async function getLedgerList(
  vyapariIds: string[],
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase.rpc('find_ledger_transactions_list', {
    vyapari_ids: vyapariIds,
    start_date: startDate,
    end_date: endDate,
  });

  if (error) throw error;
  return data;
}

export async function listAllVyapariLedger(
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase.rpc('list_vyapari_ledger_all', {
    start_date: startDate,
    end_date: endDate,
  });

  if (error) throw error;
  return data;
}

export async function getVasuliList(
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase.rpc('get_vasuli_list', {
    start_date: startDate,
    end_date: endDate,
  });

  if (error) throw error;
  return data;
}

export async function editVasuli(vasuli: any) {
  const { data, error } = await supabase
    .from('vasuli')
    .update(vasuli)
    .eq('id', vasuli.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPendingVasuli(showToday: boolean) {
  const { data, error } = await supabase.rpc('get_pending_vasuli', {
    showtoday: showToday,
  });

  if (error) throw error;
  return data;
}

export async function notifyVasuli(dto: NotifyVasuliDto) {
  const { data, error } = await supabase.rpc('notify_vasuli', dto);
  if (error) throw error;
  return data;
}
