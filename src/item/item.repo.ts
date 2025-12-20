import { supabase } from '../common/supabase';
import { AddItemRequestDTO } from './items.models';

export async function insertItems(items: AddItemRequestDTO[]) {
  const payload = items.map(i => ({
    item_id: i.item_id,
    name: i.name,
  }));

  const { data, error } = await supabase
    .from('items')
    .insert(payload)
    .select();

  if (error) throw error;
  return data;
}

export async function fetchAllItems() {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('name');

  if (error) throw error;
  return data;
}
