import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { notFound } from '../common/error';
import {
  AddAuctionDto,
  DeleteAuctionTransactionDto,
  EditAuctionDTO,
  EditAuctionTransactionDTO,
} from './auction.models';

export async function addAuction(
  auctions: AddAuctionDto[],
  deviceId: string
) {
  const payload = auctions.map(({ itemId, kisanId, ...rest }) => ({ ...rest, item_id: itemId, kisan_id: kisanId }));
  logger.debug('RPC: create_auction_bulk_with_crate', { deviceId, count: auctions.length });
  // const { data, error } = await supabase.rpc('create_auction_bulk', {
  const { data, error } = await supabase.rpc('create_auction_bulk_with_crate', {
    p_payload: payload,
    p_device_id: Number(deviceId),
  });

  if (error) throw error;
  return data;
}

export async function generateAuctionLedger(
  startDate: string,
  endDate: string
) {
  logger.debug('RPC: generate_auction_ledger', { startDate, endDate });
  const { data, error } = await supabase.rpc(
    'generate_auction_ledger',
    {
      start_time: startDate,
      end_time: endDate,
    }
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function editAuction(
  dto: EditAuctionDTO
) {
  const newPayload = dto.addAuctionDtos.map(({ itemId, kisanId, ...rest }) => ({ ...rest, item_id: itemId, kisan_id: kisanId }));
  logger.debug('RPC: edit_auction_by_recreate2', { deleteCount: dto.deleteAuctionTransactionDto.auctionTransactionIds.length, addCount: newPayload.length });
  const { data, error } = await supabase.rpc('edit_auction_by_recreate2', {
    auction_transaction_ids: dto.deleteAuctionTransactionDto.auctionTransactionIds,
    new_payload: newPayload,
  });

  if (error) {
    console.log('Error in editAuction:', error);
    throw error;
  }
  return data;
}

export async function editAuctionTransaction(
  dto: EditAuctionTransactionDTO
) {
  const modifiedDto = {
    p_auction_transaction_id: dto.auctionTransactionId,
    p_bag: Number(dto.bag),
    p_bag_wise_quantity: dto.bagWiseQuantity?.join(',') ?? '',
    p_chungi: Number(dto.chungi),
    p_new_vyapari_id: dto.vyapariId,
    p_quantity: Number(dto.quantity),
    p_rate: Number(dto.rate)
  };

  logger.debug('RPC: edit_auction_transaction', { auctionTransactionId: dto.auctionTransactionId });
  const { data, error } = await supabase
    .rpc('edit_auction_transaction', modifiedDto);

  if (error) throw error;
  return data;
}

export async function listAuctionTransaction(
  startDate: string,
  endDate: string,
  deviceId?: string | null
) {
  logger.debug('RPC: get_auction_transactions_report3', { startDate, endDate, deviceId });
  const { data, error } = await supabase.rpc(
    'get_auction_transactions_report3',
    {
      start_date: startDate,
      end_date: endDate,
      device_id_param: deviceId != null ? Number(deviceId) : null,
    }
  );
  if (error) throw error;
  return data;
}

export async function deleteAuctionTransactions(
  dto: DeleteAuctionTransactionDto
) {
  logger.debug('RPC: delete_auction_transactions', { count: dto.auctionTransactionIds.length });
  const { data, error } = await supabase.rpc(
    'delete_auction_transactions',
    dto
  );
  if (error) {
    // The RPC raises this when NONE of the requested ids exist (it used to
    // return true, hiding stale/wrong ids). Partial matches still succeed.
    if (error.message?.includes('AUCTION_TXN_NOT_FOUND')) {
      throw notFound('No matching auction transactions found for the given ids');
    }
    throw error;
  }
  return data;
}

export async function markTransactionValidated(
  fromDate: string,
  toDate: string,
  vyapariId: string
) {
  logger.debug('RPC: mark_transaction_validated', { fromDate, toDate, vyapariId });
  const { data, error } = await supabase.rpc(
    'mark_transaction_validated',
    {
      from_date: fromDate,
      to_date: toDate,
      vyapari_id: vyapariId,
    }
  );
  if (error) throw error;
  return data;
}
