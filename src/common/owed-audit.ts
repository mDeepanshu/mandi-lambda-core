import { supabase } from './supabase';
import { logger } from './logger';

// Logs every affected party's owed_amount before and after a money-moving
// write ("Owed audit"), so a real operation can be checked against what it
// should have done. Best-effort: a failed audit read is logged and never
// fails or blocks the write itself.

type Snapshot = Map<string, { name: string | null; owed: number | null }>;

async function snapshot(partyIds: string[]): Promise<Snapshot | null> {
  if (!partyIds.length) return new Map();
  try {
    const { data, error } = await supabase
      .from('party')
      .select('party_id, name, owed_amount')
      .in('party_id', partyIds);
    if (error) throw error;
    return new Map(
      (data ?? []).map((p: any) => [p.party_id, { name: p.name, owed: p.owed_amount == null ? null : Number(p.owed_amount) }])
    );
  } catch (e) {
    logger.warn('Owed audit snapshot failed', { error: (e as Error).message });
    return null;
  }
}

export async function auditOwed<T>(
  action: string,
  partyIds: (string | null | undefined)[] | Promise<(string | null | undefined)[]>,
  write: () => Promise<T>
): Promise<T> {
  let ids: string[] = [];
  try {
    ids = [...new Set((await partyIds).filter((id): id is string => !!id))];
  } catch (e) {
    logger.warn('Owed audit could not resolve parties', { action, error: (e as Error).message });
  }

  const before = await snapshot(ids);
  const result = await write();
  const after = await snapshot(ids);

  if (before && after) {
    const changes = ids.map((partyId) => {
      const b = before.get(partyId)?.owed ?? null;
      const a = after.get(partyId)?.owed ?? null;
      return {
        partyId,
        name: after.get(partyId)?.name ?? before.get(partyId)?.name ?? null,
        before: b,
        after: a,
        delta: a != null && b != null ? Math.round((a - b) * 100) / 100 : null,
      };
    });
    logger.info('Owed audit', { action, changes });
  }
  return result;
}

// vyaparis of existing auction transactions (edit / delete targets)
export async function vyapariIdsOfTransactions(txnIds: string[]): Promise<string[]> {
  if (!txnIds.length) return [];
  const { data, error } = await supabase
    .from('auction_transaction')
    .select('vyapari_id')
    .in('auction_transaction_id', txnIds);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.vyapari_id);
}

// vyapari of an existing vasuli (edit target)
export async function vyapariIdOfVasuli(vasuliId: string): Promise<string[]> {
  const { data, error } = await supabase.from('vasuli').select('vyapari_id').eq('id', vasuliId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.vyapari_id);
}
