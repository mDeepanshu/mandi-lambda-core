import { supabase } from '../common/supabase';
import {
  KisanBillDTO,
  KisanBillResponseDTO,
  KisanBillPaymentResponseDTO,
} from './kisan.models';

export async function fetchBillTransactions(
  billId: string
): Promise<KisanBillResponseDTO[]> {
  const { data, error } = await supabase
    .rpc('get_kisan_bill_by_id', { p_bill_id: billId });

  if (error) throw error;
  return data;
}

export async function saveBill(
  kisanId: string,
  date: string,
  dto: KisanBillDTO,
) {
  const { data, error } = await supabase
    .rpc('create_kisan_bill', {
      p_payload: dto
    });
  if (error) throw error;
  return data;
}

export async function fetchKisanBillSummary(
  date: string,
): Promise<any> {
  const { data, error } = await supabase.rpc('get_kisan_bills_by_date', {
    p_bill_date: date
  });
  if (error) throw error;
  return data;
}

export async function fetchPendingItemsSummary(
  startDate?: string,
  endDate?: string
): Promise<any> {
  const { data, error } = await supabase
    .rpc('pending_items_summary', {
      start_date: startDate,
      end_date: endDate,
    });

  if (error) throw error;
  return data;
}

export async function fetchPendingByKisanId(
  kisanId: string
): Promise<any> {
  const { data, error } = await supabase.rpc('get_pending_stock_by_kisan_id', {
    p_kisan_id: kisanId
  });
  if (error) throw error;
  return data;
}