import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { DeviceDetailsDTO, DeviceStatus } from './device.models';

export async function insertDevice(name: string): Promise<DeviceDetailsDTO> {
  logger.debug('Table: device_details insert', { name });
  const { data, error } = await supabase
    .from('device_details')
    .insert({ name })
    .select()
    .single();

  if (error) throw error;
  return data as DeviceDetailsDTO;
}

// camelCase entities in id order, as the old server listed them
export async function fetchDevicesByStatus(statusList: DeviceStatus[]) {
  logger.debug('RPC: legacy_list_devices', { statusList });
  const { data, error } = await supabase.rpc('legacy_list_devices', { p_statuses: statusList });

  if (error) throw error;
  return data;
}

export async function fetchDeviceStatus(id: number): Promise<DeviceStatus | null> {
  logger.debug('Table: device_details select status', { id });
  const { data, error } = await supabase
    .from('device_details')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return (data?.status as DeviceStatus) ?? null;
}

export async function updateDeviceStatus(id: number, status: DeviceStatus): Promise<DeviceDetailsDTO> {
  logger.debug('Table: device_details update', { id, status });
  const { data, error } = await supabase
    .from('device_details')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as DeviceDetailsDTO;
}
