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

export const generateLedger = (
  startDate: string,
  endDate?: string
) =>
  repo.generateLedger(startDate, endDate);

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
  await repo.deleteAuctionTransactions(
    dto.deleteAuctionTransactionDto
  );
  await repo.addAuction(dto.addAuctionDtos, deviceId);
};

export const markTransactionValidated = (
  fromDate: string,
  toDate: string,
  vyapariId: string
) =>
  repo.markTransactionValidated(fromDate, toDate, vyapariId);
