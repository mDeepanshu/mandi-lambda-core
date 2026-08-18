import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { EditVasuliDto, NotifyVasuliDto } from './vyapari.models';

export async function generateBill(vyapariId: string, date: string) {

  function getDayRange(dateStr: string) {
    // dateStr format: YYYY-MM-DD
    const start = new Date(`${dateStr}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const format = (d: Date) =>
      d.toISOString().slice(0, 19).replace('T', ' ');

    return {
      start_date: format(start), // "2025-12-27 00:00:00"
      end_date: format(end),     // "2025-12-28 00:00:00"
    };
  }
  const { start_date, end_date } = getDayRange(date);

  logger.debug('RPC: generate_bill_by_vyapari_id_and_date', { vyapariId, date });
  const { data, error } = await supabase
    .rpc('generate_bill_by_vyapari_id_and_date', { vyapari_id_param: vyapariId, start_date, end_date });

  if (error) throw error;
  if (data && Array.isArray(data.billList)) {
    data.billList = data.billList.map((item: any) => [item]);
  }
  return data;
}

export async function generateLedger(
  vyapariId: string,
  startDate: string,
  endDate: string,
  filterOutNonValidated: boolean
) {
  logger.debug('RPC: find_ledger_transactions', { vyapariId, startDate, endDate });
  const { data, error } = await supabase.rpc('find_ledger_transactions', {
    p_vyapari_id: vyapariId,
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
  logger.debug('RPC: find_ledger_transactions_list', { count: vyapariIds.length, startDate, endDate });
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
  logger.debug('RPC: list_vyapari_ledger_all', { startDate, endDate });
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
  logger.debug('RPC: get_vasuli_list2', { startDate, endDate });
  const { data, error } = await supabase.rpc('get_vasuli_list2', {
    start_date: startDate,
    end_date: endDate,
  });

  if (error) throw error;
  return data;
}

export async function editVasuli(vasuli: EditVasuliDto) {
  logger.debug('RPC: edit_vasuli', { id: vasuli.id });
  const { data, error } = await supabase.rpc('edit_vasuli', {
    p_id: vasuli.id,
    p_amount: vasuli.amount,
    p_date: vasuli.date,
    p_vyapari_id: vasuli.vyapariId,
    p_remark: vasuli.remark,
    p_was_null: vasuli.wasNull,
  });
  if (error) throw error;
  return data;
}

export async function getPendingVasuli(showToday: boolean) {
  logger.debug('RPC: get_pending_vasuli', { showToday });
  const { data, error } = await supabase.rpc('get_pending_vasuli', {
    showtoday: showToday,
  });

  if (error) throw error;
  return data;
}

export async function notifyVasuli(dto: NotifyVasuliDto) {
  logger.debug('RPC: notify_vasuli', { vyapariId: dto.vyapari_id_param });
  const { data, error } = await supabase.rpc('notify_vasuli', dto);
  if (error) throw error;
  return data;
}
