import { supabase } from '../common/supabase';
import { DeviceStatus } from './device.models';

export async function insertDevice(name: string) {
  const { data, error } = await supabase
    .from('device')
    .insert({ name })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchDevicesByStatus(
  statusList: DeviceStatus[]
) {
  const { data, error } = await supabase
    .from('device')
    .select('*')
    .in('status', statusList);

  if (error) throw error;
  return data;
}

export async function updateDeviceStatus(
  id: number,
  status: DeviceStatus
) {
  const { data, error } = await supabase
    .from('device')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
