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

export async function fetchDevicesByStatus(statusList: DeviceStatus[]): Promise<DeviceDetailsDTO[]> {
  logger.debug('Table: device_details select', { statusList });
  const { data, error } = await supabase
    .from('device_details')
    .select('*')
    .in('status', statusList);

  if (error) throw error;
  return data as DeviceDetailsDTO[];
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
