export interface AddAuctionTransactionDTO {
  // made by the app when the lot is entered; a lot already saved under this
  // id is skipped, so a retried POST cannot duplicate it
  auctionTransactionId?: string;
  rate?: number | null;
  quantity?: number | null;
  bag?: number | null;
  chungi?: number | null;
  crate_count?: number | null;
  bagWiseQuantity?: number[];
}

export interface AddAuctionDto {
  // made by the app when the auction is started (see auctionTransactionId)
  auctionId?: string;
  kisanId: string;
  itemId?: string;
  // auction-level bag count: `bag` from the frontends (old-server name),
  // `total_bags` from the old server's mirror, `bagTotal` from older callers
  bag?: number | null;
  bagTotal?: number | null;
  total_bags?: number | null;
  crate_id?: number | null;
  buyItems?: AddAuctionTransactionDTO[];
  auctionDate?: string; // yyyy-MM-dd
  deviceId?: string | number | null;
}

export interface DeleteAuctionTransactionDto {
  auctionTransactionIds: string[];
}

export interface EditAuctionDTO {
  deleteAuctionTransactionDto: DeleteAuctionTransactionDto;
  addAuctionDtos: AddAuctionDto[];
}

// auction_create_v2's answer: what this call inserted vs. found already saved
export interface AuctionCreateResult {
  created: number;
  alreadySaved: number;
  auctions: {
    auctionId: string;
    transactions: { auctionTransactionId: string; status: 'CREATED' | 'ALREADY_SAVED' | 'DELETED' }[];
  }[];
}

export interface EditAuctionTransactionDTO {
  auctionTransactionId: string;
  // id for the replacement row, made by the app; makes a retried edit a no-op
  newAuctionTransactionId?: string;
  auctionDate?: string;
  vyapariId?: string;
  rate?: number;
  quantity?: number;
  bag?: number;
  chungi?: number;
  bagWiseQuantity?: number[];
}
