import { supabase } from '../common/supabase';
import {
  KisanBillDTO,
  KisanBillResponseDTO,
  KisanBillPaymentResponseDTO,
} from './kisan.models';

export async function fetchBillTransactions(
  kisanId: string,
  date: string
): Promise<KisanBillResponseDTO[]> {
  const { data, error } = await supabase
    .rpc('generate_kisan_bill', { kisan_id: kisanId, bill_date: date });

  if (error) throw error;
  return data;
}

export async function saveBill(
  kisanId: string,
  date: string,
  dto: KisanBillDTO
) {
  const { data, error } = await supabase
    .rpc('save_kisan_bill', {
      kisan_id: kisanId,
      bill_date: date,
      payload: dto,
    });

  if (error) throw error;
  return data;
}

export async function fetchKisanBillSummary(
  startDate?: string,
  endDate?: string,
  listLive = false
): Promise<KisanBillPaymentResponseDTO> {
  const { data, error } = await supabase
    .rpc('kisan_bill_payment_summary', {
      start_date: startDate,
      end_date: endDate,
      list_live: listLive,
    });

  if (error) throw error;
  return data;
}
