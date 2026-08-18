import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { AddItemRequestDTO } from './items.models';

export async function insertItems(items: AddItemRequestDTO[]) {
  const payload = items.map(i => ({
    item_id: i.itemId,
    name: i.name,
  }));

  logger.debug('Table: items insert', { count: items.length });
  const { data, error } = await supabase
    .from('items')
    .insert(payload)
    .select();

  if (error) throw error;
  return data;
}

export async function fetchAllItems() {
  logger.debug('Table: items select');
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('name');

  if (error) throw error;
  return data.map(({ item_id, ...rest }) => ({ itemId: item_id, ...rest }));
}
