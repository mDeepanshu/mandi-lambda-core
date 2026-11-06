import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { notFound } from '../common/error';
import { EditVasuliBodySchemaType } from './validation';

// Every read here is a legacy_* function (db/legacy_parity_api.sql) returning
// the old Spring server's JSON exactly; see that file for the rules.

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  logger.debug(`RPC: ${fn}`, args);
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const generateBill = (vyapariId: string, date: string) =>
  rpc('legacy_vyapari_bill', { p_vyapari_id: vyapariId, p_day: date });

// vyapariApp: the request came from the Vyapari app (vyapariCode header)
export const generateLedger = (vyapariId: string, startDate: string, endDate: string, vyapariApp: boolean) =>
  rpc('legacy_vyapari_ledger', { p_vyapari_id: vyapariId, p_start: startDate, p_end: endDate, p_vyapari_app: vyapariApp });

export const getLedgerList = (vyapariIds: string[], startDate: string, endDate: string) =>
  rpc('legacy_ledger_list', { p_vyapari_ids: vyapariIds, p_start: startDate, p_end: endDate });

export const listAllVyapariLedger = (startDate: string, endDate: string) =>
  rpc('legacy_ledger_list_all', { p_start: startDate, p_end: endDate });

export const getVasuliList = (startDate: string, endDate: string) =>
  rpc('legacy_vasuli_list', { p_start: startDate, p_end: endDate });

export async function editVasuli(vasuli: EditVasuliBodySchemaType) {
  try {
    return await rpc('legacy_edit_vasuli', { p: vasuli });
  } catch (e: any) {
    if (e?.message?.includes('VASULI_NOT_FOUND')) throw notFound(`Vasuli entry not found for id: ${vasuli.id}`);
    throw e;
  }
}

export const getPendingVasuli = (showToday: boolean) =>
  rpc('legacy_pending_vasuli', { p_show_today: showToday });

// notify-vasuli records the amount just notified (the old server stored the
// message text; it is always the amount)
export async function setLastNotifiedAmount(vyapariId: string, amount: number) {
  logger.debug('Table: party update last_notified_amount', { vyapariId });
  const { error } = await supabase
    .from('party')
    .update({ last_notified_amount: amount })
    .eq('party_id', vyapariId);
  if (error) throw error;
}
