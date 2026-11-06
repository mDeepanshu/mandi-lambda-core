import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { AddItemRequestDTO } from './items.models';

const toItem = ({ item_id, name }: { item_id: string; name: string }) => ({ itemId: item_id, name });

// JPA saveAll(): an existing itemId is updated, not rejected
export async function insertItems(items: AddItemRequestDTO[]) {
  const payload = items.map(i => ({
    item_id: i.itemId ?? i.item_id,
    name: i.name,
  }));

  logger.debug('Table: items upsert', { count: items.length });
  const { data, error } = await supabase
    .from('items')
    .upsert(payload, { onConflict: 'item_id' })
    .select();

  if (error) throw error;
  return data.map(toItem);
}

// primary-key order, case-insensitive — what the old server's findAll() returned
export async function fetchAllItems() {
  logger.debug('Table: items select');
  const { data, error } = await supabase
    .from('items')
    .select('item_id, name');

  if (error) throw error;
  return data
    .map(toItem)
    .sort((a, b) => {
      const x = a.itemId.toLowerCase(), y = b.itemId.toLowerCase();
      return x < y ? -1 : x > y ? 1 : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
    });
}
