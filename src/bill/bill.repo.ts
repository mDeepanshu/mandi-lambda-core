import { supabase } from '../common/supabase';
import { KisanBill, VyapariBill } from './bill.models';

export async function saveKisanBill(bill: KisanBill) {
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
  const { error } = await supabase.rpc('auto_save_bills');
  if (error) throw error;
}
