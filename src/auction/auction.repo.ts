import { supabase } from '../common/supabase';
import { logger } from '../common/logger';
import { badRequest, conflict, notFound } from '../common/error';
import {
  AddAuctionDto,
  AuctionCreateResult,
  DeleteAuctionTransactionDto,
  EditAuctionDTO,
  EditAuctionTransactionDTO,
} from './auction.models';

// Error codes raised by the auction write functions (db/auction_write_v2.sql),
// as the prefix of the Postgres exception message. The code is passed through
// in responseBody so the app can tell "reload, someone changed it" (STALE)
// from "this id was reused for something else" (ID_CONFLICT).
function mapAuctionWriteError(error: { message?: string }): never {
  const message = error.message ?? '';
  const code = message.match(/^(AUCTION_[A-Z_]+):/)?.[1];
  const detail = code ? message.slice(code.length + 1).trim() : message;
  if (code === 'AUCTION_VALIDATION') throw badRequest(detail, { code });
  if (code === 'AUCTION_ID_CONFLICT' || code === 'AUCTION_TXN_STALE') throw conflict(detail, { code });
  throw error;
}

// Payload keys as create_auction_bulk_with_crate reads them, filled the way the
// old server filled its rows: auction.bag from `bag`, auction.device_id from
// the auction's own deviceId else the request header, and a missing rate as 0
// (AddAuctionTransactionDTO's default).
const toRpcAuction = ({ itemId, kisanId, bag, bagTotal, ...rest }: AddAuctionDto, headerDeviceId?: string) => ({
  ...rest,
  item_id: itemId,
  kisan_id: kisanId,
  total_bags: rest.total_bags ?? bag ?? bagTotal,
  device_id: rest.deviceId ?? headerDeviceId,
  buyItems: rest.buyItems?.map((b) => ({ ...b, rate: b.rate ?? 0 })),
});

// auctionId / auctionTransactionId, when the app sends them, travel inside the
// payload untouched: they are what makes a retried POST a no-op instead of a
// duplicate (lots already saved are skipped, and owed_amount only moves for
// rows this call inserted).
export async function addAuction(
  auctions: AddAuctionDto[],
  deviceId: string
): Promise<AuctionCreateResult> {
  const payload = auctions.map((a) => toRpcAuction(a, deviceId));
  logger.debug('RPC: auction_create_v2', { deviceId, count: auctions.length });
  const { data, error } = await supabase.rpc('auction_create_v2', {
    p_payload: payload,
    p_device_id: Number(deviceId),
  });

  if (error) mapAuctionWriteError(error);
  return data as AuctionCreateResult;
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
  dto: EditAuctionDTO,
  deviceId: string
) {
  const newPayload = dto.addAuctionDtos.map((a) => toRpcAuction(a, deviceId));
  logger.debug('RPC: edit_auction_by_recreate2', { deleteCount: dto.deleteAuctionTransactionDto.auctionTransactionIds.length, addCount: newPayload.length });
  const { data, error } = await supabase.rpc('edit_auction_by_recreate2', {
    auction_transaction_ids: dto.deleteAuctionTransactionDto.auctionTransactionIds,
    new_payload: newPayload,
  });

  if (error) {
    // the replaced rows go through delete_auction_transactions, which says
    // AUCTION_TXN_NOT_FOUND only if none exist -- the RPC's own stale check
    // runs first, so that case surfaces as AUCTION_TXN_STALE (409)
    mapAuctionWriteError(error);
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
    p_rate: Number(dto.rate),
    // the replacement row's id, made by the app: a retried edit finds it
    // already saved and returns without moving money a second time
    p_new_auction_transaction_id: dto.newAuctionTransactionId ?? null,
  };

  logger.debug('RPC: edit_auction_transaction', { auctionTransactionId: dto.auctionTransactionId });
  const { data, error } = await supabase
    .rpc('edit_auction_transaction', modifiedDto);

  if (error) {
    if (error.message?.includes('Auction transaction not found')) {
      throw notFound(`Auction Transaction with id ${dto.auctionTransactionId} Not Found`);
    }
    if (error.message?.includes('Invalid vyapari id')) throw badRequest('Invalid vyapari id');
    mapAuctionWriteError(error);
  }
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
    mapAuctionWriteError(error);
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

export async function markBulkTransactionValidated(
  fromDate: string,
  toDate: string
) {
  logger.debug('RPC: mark_bulk_transaction_validated', { fromDate, toDate });
  const { data, error } = await supabase.rpc(
    'mark_bulk_transaction_validated',
    {
      from_date: fromDate,
      to_date: toDate,
    }
  );
  if (error) throw error;
  return data;
}
