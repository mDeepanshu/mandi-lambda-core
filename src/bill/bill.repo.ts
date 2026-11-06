import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { KisanBill, VyapariBill } from './bill.models';

export async function saveKisanBill(bill: KisanBill) {
  logger.debug('RPC: save_kisan_bill');
  const { data, error } = await supabase.rpc('save_kisan_bill', {
    payload: bill,
  });
  if (error) throw error;
  return data;
}

export async function getKisanBill(
  kisanId: string,
  billDate: string,
  index: number
) {
  logger.debug('RPC: get_kisan_bill_by_kisan_id_and_date', { kisanId, billDate, index });
  const { data, error } = await supabase.rpc(
    'get_kisan_bill_by_kisan_id_and_date',
    {
      kisan_id: kisanId,
      bill_date: billDate,
      bill_index: index,
    }
  );
  if (error) throw error;
  return data;
}

// The old server's VyapariBill entity as saved (db/legacy_parity_api.sql)
export async function saveVyapariBill(bill: VyapariBill) {
  logger.debug('RPC: legacy_save_vyapari_bill');
  const { data, error } = await supabase.rpc('legacy_save_vyapari_bill', { p: bill });
  if (error) throw error;
  return data;
}

// A Spring Page of one bill (newest first), or null past the last one
export async function getVyapariBill(
  vyapariId: string,
  billDate: string,
  index: number
) {
  logger.debug('RPC: legacy_get_vyapari_bill', { vyapariId, billDate, index });
  const { data, error } = await supabase.rpc('legacy_get_vyapari_bill', {
    p_vyapari_id: vyapariId,
    p_bill_date: billDate,
    p_index: index,
  });
  if (error) throw error;
  return data;
}

export async function autoSaveBills() {
  logger.debug('RPC: auto_save_bills');
  const { error } = await supabase.rpc('auto_save_bills');
  if (error) throw error;
}
