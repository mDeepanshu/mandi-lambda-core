import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { badRequest, conflict } from '../common/error';
import { CrateIssueRequest, CrateReturnRequest, EditCrateAuctionEntryRequest, EditCrateSummaryRequest, EditCrateVasuliRequest } from './crate.model';

export async function createCrate(
    crateName: string,
    total: number,
    closingAmount: number
) {
    logger.debug('RPC: create_crate', { crateName, total });
    const { data, error } = await supabase.rpc('create_crate', {
        p_closing_amount: closingAmount,
        p_crate_name: crateName,
        p_total: total
    });
    if (error) throw error;
    return data;
}

export async function getCrates() {
    logger.debug('Table: crate select');
    const { data, error } = await supabase
        .from('crate')
        .select('*');

    if (error) throw error;
    return data;
}

export async function getCrateSummaryByDate(p_date: string) {
    logger.debug('RPC: get_crate_summary_by_date', { p_date });
    const { data, error } = await supabase
        .rpc('get_crate_summary_by_date', {
            p_date
        });
    if (error) throw error;
    return data;
}

export async function getCrateSummaryFromLogByDate(p_date: string) {
    logger.debug('RPC: get_crate_summary_by_date_from_log', { p_date });
    const { data, error } = await supabase
        .rpc('get_crate_summary_by_date_from_log', {
            p_date
        });
    if (error) throw error;
    return data;
}

export async function getCrateStockReportByDate(p_date: string) {
    logger.debug('RPC: get_crate_stock_report', { p_date });
    const { data, error } = await supabase
        .rpc('get_crate_stock_report', {
            p_date
        });
    if (error) throw error;
    return data;
}

export async function getCrateLedger(p_from_date: string, p_to_date: string, p_vyapari_id: string) {
    logger.debug('RPC: get_crate_ledger', { p_from_date, p_to_date, p_vyapari_id });
    const { data, error } = await supabase
        .rpc('get_crate_ledger', {
            p_from_date,
            p_to_date,
            p_vyapari_id
        });
    if (error) throw error;
    return data;
}

export async function getCrateVasuliSheet(p_date: string) {
    logger.debug('RPC: get_crate_vasuli_sheet', { p_date });
    const { data, error } = await supabase
        .rpc('get_crate_vasuli_sheet', {
            p_date
        });
    if (error) throw error;
    return data;
}

export async function getPendingCrateSummary() {
    logger.debug('RPC: get_pending_crate_summary');
    const { data, error } = await supabase
        .rpc('get_pending_crate_summary');
    if (error) throw error;
    return data;
}

export async function getPendingCratesByVyapari(p_vyapari_id: string) {
    logger.debug('RPC: get_pending_crates_by_vyapari', { p_vyapari_id });
    const { data, error } = await supabase
        .rpc('get_pending_crates_by_vyapari', {
            p_vyapari_id
        });
    if (error) throw error;
    return data;
}

export async function crateIssue(p_payload: CrateIssueRequest) {
    // Aggregation lives in the RPC: same-day re-issues for a (vyapari, crate,
    // date) combo are summed into the existing row via ON CONFLICT DO UPDATE.
    logger.debug('RPC: create_crate_issue', { vyapariId: p_payload.vyapariId });
    const { data, error } = await supabase
        .rpc('create_crate_issue', {
            p_payload
        });
    if (error) {
        if (error.code === '23503') throw badRequest('Vyapari or crate not found', error.details);
        throw error;
    }
    return data;
}

export async function editCrateSummary(p_payload: EditCrateSummaryRequest) {
    // Absolute set: the RPC overwrites crate_count for the crate_ids sent and
    // deletes the ones sent with count 0. Crates absent from the payload are left alone.
    logger.debug('RPC: edit_crate_summary', { vyapariId: p_payload.vyapariId, date: p_payload.date });
    const { data, error } = await supabase
        .rpc('edit_crate_summary', {
            p_payload
        });
    if (error) {
        if (error.code === '23503') throw badRequest('Vyapari or crate not found', error.message);
        throw error;
    }
    return data;
}

export async function getCrateVasuliList(p_date: string) {
    logger.debug('RPC: get_crate_vasuli_list', { p_date });
    const { data, error } = await supabase
        .rpc('get_crate_vasuli_list', {
            p_date
        });
    if (error) throw error;
    return data;
}

export async function editCrateVasuli(p_payload: EditCrateVasuliRequest) {
    // Absolute set: the RPC overwrites the RETURN rows for the crate_ids sent and
    // deletes the ones sent with count 0. The day's ISSUE rows are left alone.
    // With newVyapariId the crate_ids move to another vyapari instead.
    logger.debug('RPC: edit_crate_vasuli', { vyapariId: p_payload.vyapariId, newVyapariId: p_payload.newVyapariId, date: p_payload.date });
    const { data, error } = await supabase
        .rpc('edit_crate_vasuli', {
            p_payload
        });
    if (error) {
        if (error.code === '23503') throw badRequest('Vyapari or crate not found', error.message);
        throw error;
    }
    // The move would combine both vyaparis' counts, so the RPC wrote nothing and
    // handed back a preview. The client re-sends with confirmMerge to go ahead.
    if (data?.status === 'CONFLICT') {
        throw conflict('Target vyapari already has a vasuli entry on this date', data);
    }
    return data;
}

export async function getCrateAuctionList(p_date: string) {
    logger.debug('RPC: get_crate_auction_list', { p_date });
    const { data, error } = await supabase
        .rpc('get_crate_auction_list', {
            p_date
        });
    if (error) throw error;
    return data;
}

export async function editCrateAuctionEntry(p_payload: EditCrateAuctionEntryRequest) {
    logger.debug('RPC: edit_crate_auction_entry', { id: p_payload.id, crateId: p_payload.crate_id });
    const { data, error } = await supabase
        .rpc('edit_crate_auction_entry', {
            p_payload
        });
    if (error) {
        if (error.code === '23503') throw badRequest('Auction crate entry or crate not found', error.message);
        // the pairing already has an entry for the target crate type
        if (error.code === '23505') throw badRequest(error.message);
        throw error;
    }
    return data;
}

export async function crateReturn(p_payload: CrateReturnRequest) {
    logger.debug('RPC: create_crate_return', { vyapariId: p_payload.vyapariId });
    const { data, error } = await supabase
        .rpc('create_crate_return', {
            p_payload
        });
    if (error) {
        if (error.code === '23503') throw badRequest('Vyapari or crate not found', error.details);
        throw error;
    }
    return data;
}
