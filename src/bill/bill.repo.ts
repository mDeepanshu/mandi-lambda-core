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

export async function saveVyapariBill(bill: VyapariBill) {
  logger.debug('RPC: save_vyapari_bill');
  const { data, error } = await supabase.rpc('save_vyapari_bill', {
    payload: bill,
  });
  if (error) throw error;
  return data;
}

export async function getVyapariBill(
  vyapariId: string,
  billDate: string,
  index: number
) {
  logger.debug('RPC: get_vyapari_bill_by_vyapari_id_and_date', { vyapariId, billDate, index });
  const { data, error } = await supabase.rpc(
    'get_vyapari_bill_by_vyapari_id_and_date',
    {
      vyapari_id: vyapariId,
      bill_date: billDate,
      bill_index: index,
    }
  );
  if (error) throw error;
  return data;
}

export async function autoSaveBills() {
  logger.debug('RPC: auto_save_bills');
  const { error } = await supabase.rpc('auto_save_bills');
  if (error) throw error;
}
