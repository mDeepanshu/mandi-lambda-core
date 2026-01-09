import { supabase } from '../common/supabase';
import {
  AddAuctionDto,
  DeleteAuctionTransactionDto,
  // EditAuctionTransactionDTO,
} from './auction.models';

export async function addAuction(
  auctions: AddAuctionDto[],
  deviceId: string
) {
  const { data, error } = await supabase.rpc('add_auction', {
    payload: auctions,
    device_id: deviceId,
  });
  if (error) throw error;
  return data;
}

export async function generateAuctionLedger(
  startDate: string,
  endDate: string
) {
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

export async function editAuctionTransaction(
  dto: any
) {

  // const modifiedDto = {
  //   p_auction_transaction_id: dto.auctionTransactionId,
  //   p_bag: Number(dto.bag),
  //   p_bag_wise_quantity: dto.bagWiseQuantity,
  //   p_chungi: Number(dto.chungi),
  //   p_new_vyapari_id: dto.vyapariId,
  //   p_quantity: Number(dto.quantity),
  //   p_rate: Number(dto.rate)
  // };
  
  const { data, error } = await supabase.rpc('edit_auction_by_recreate',{
    auction_transaction_ids: dto.deleteAuctionTransactionDto.auctionTransactionIds,
    new_payload: dto.addAuctionDtos
  });

  if (error) throw error;
  return data;
}

export async function listAuctionTransaction(
  startDate: string,
  endDate: string,
  deviceId?: string | null
) {
  const { data, error } = await supabase.rpc(
    'get_auction_transactions_report2',
    {
      start_date: startDate,
      end_date: endDate,
      device_id_param: deviceId,
    }
  );
  if (error) return error;
  return data;
}

export async function deleteAuctionTransactions(
  dto: DeleteAuctionTransactionDto
) {
  const { data, error } = await supabase.rpc(
    'delete_auction_transactions',
    dto
  );
  if (error) throw error;
  return data;
}

export async function markTransactionValidated(
  fromDate: string,
  toDate: string,
  vyapariId: string
) {
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
