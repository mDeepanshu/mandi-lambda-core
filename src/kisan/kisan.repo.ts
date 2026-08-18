import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import {
  KisanBillDTO,
  KisanBillResponseDTO,
} from './kisan.models';

export async function fetchBillTransactions(
  billId: string
): Promise<KisanBillResponseDTO[]> {
  logger.debug('RPC: get_kisan_bill_by_id', { billId });
  const { data, error } = await supabase
    .rpc('get_kisan_bill_by_id', { p_bill_id: billId });

  if (error) {
    if (error.message === 'Kisan bill not found') return [];
    throw error;
  }
  return data;
}

export async function saveBill(
  kisanId: string,
  date: string,
  dto: KisanBillDTO,
) {
  logger.debug('RPC: create_kisan_bill', { kisanId, date });
  const { data, error } = await supabase
    .rpc('create_kisan_bill', {
      p_payload: dto
    });
  if (error) throw error;
  return {billId: data};
}

export async function fetchKisanBillSummary(
  date: string,
): Promise<any> {
  logger.debug('RPC: get_kisan_bills_by_date', { date });
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
  logger.debug('RPC: pending_items_summary', { startDate, endDate });
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
  logger.debug('RPC: get_pending_stock_by_kisan_id', { kisanId });
  const { data, error } = await supabase.rpc('get_pending_stock_by_kisan_id', {
    p_kisan_id: kisanId
  });
  if (error) throw error;
  return data;
}

export async function markPendingAsSold(
  pendingId: string
): Promise<any> {
  logger.debug('RPC: mark_pending_stock_sold', { pendingId });
  const { data, error } = await supabase.rpc('mark_pending_stock_sold', {
    p_id: pendingId
  });
  if (error) throw error;
  return data;
}
