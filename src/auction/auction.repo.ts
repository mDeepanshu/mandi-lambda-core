import { supabase } from '../common/supabase';
import {
  AddAuctionDto,
  DeleteAuctionTransactionDto,
  EditAuctionTransactionDTO,
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

export async function generateLedger(
  startDate: string,
  endDate?: string
) {
  const { data, error } = await supabase.rpc('auction_generate_ledger', {
    start_date: startDate,
    end_date: endDate,
  });
  if (error) throw error;
  return data;
}

export async function editAuctionTransaction(
  dto: EditAuctionTransactionDTO
) {
  const { data, error } = await supabase.rpc(
    'edit_auction_transaction',
    dto
  );
  if (error) throw error;
  return data;
}

export async function listAuctionTransaction(
  startDate: string,
  endDate: string,
  deviceId?: string | null
) {
  const { data, error } = await supabase.rpc(
    'list_auction_transaction',
    {
      start_date: startDate,
      end_date: endDate,
      device_id: deviceId,
    }
  );
  if (error) throw error;
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
