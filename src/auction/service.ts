import * as repo from './auction.repo';
import {
  AddAuctionDto,
  DeleteAuctionTransactionDto,
  EditAuctionDTO,
  EditAuctionTransactionDTO,
} from './auction.models';

export const addAuction = (
  auctions: AddAuctionDto[],
  deviceId: string
) =>
  repo.addAuction(auctions, deviceId);

export async function generateLedger(
  startDate: string,
  endDate?: string
) {
  return repo.generateAuctionLedger(
    startDate,
    endDate ?? startDate
  );
}

export const editAuctionTransaction = (
  dto: EditAuctionTransactionDTO
) =>
  repo.editAuctionTransaction(dto);

export const listAuctionTransaction = (
  startDate: string,
  endDate: string,
  deviceId?: string | null
) =>
  repo.listAuctionTransaction(startDate, endDate, deviceId);

export const deleteAuctionTransactions = (
  dto: DeleteAuctionTransactionDto
) =>
  repo.deleteAuctionTransactions(dto);

export const editAuction = async (
  dto: EditAuctionDTO,
  deviceId: string
) => {
  // await repo.deleteAuctionTransactions(
  //   dto.deleteAuctionTransactionDto
  // );
  // await repo.addAuction(dto.addAuctionDtos, deviceId);
  await repo.editAuctionTransaction(dto);
};

export const markTransactionValidated = (
  fromDate: string,
  toDate: string,
  vyapariId: string
) =>
  repo.markTransactionValidated(fromDate, toDate, vyapariId);
