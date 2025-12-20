export interface AddAuctionTransactionDTO {
  rate?: number;
  quantity?: number;
  bag?: number;
  chungi?: number;
  bagWiseQuantity?: number[];
}

export interface AddAuctionDto {
  kisanId: string;
  itemId?: string;
  bag?: number;
  buyItems?: AddAuctionTransactionDTO[];
  auctionDate?: string; // yyyy-MM-dd
  deviceId?: string;
}

export interface DeleteAuctionTransactionDto {
  auctionTransactionIds: string[];
}

export interface EditAuctionDTO {
  deleteAuctionTransactionDto: DeleteAuctionTransactionDto;
  addAuctionDtos: AddAuctionDto[];
}

export interface EditAuctionTransactionDTO {
  auctionTransactionId: string;
  auctionDate?: string;
  vyapariId?: string;
  rate?: number;
  quantity?: number;
  bag?: number;
  chungi?: number;
  bagWiseQuantity?: number[];
}
