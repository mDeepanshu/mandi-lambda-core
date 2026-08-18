import * as repo from './auction.repo';
import { toIstNaive } from '../common/datetime';
import {
  AddAuctionDto,
  DeleteAuctionTransactionDto,
  EditAuctionDTO,
  EditAuctionTransactionDTO,
} from './auction.models';

// `auctionDate` becomes auction.auction_date, which is what
// /auction/list-auction-transaction filters on. Browsers send it as a UTC ISO
// string, and the RPC's ::timestamp cast drops the zone -- so without this the
// header date lands 5h30m behind the mandi's clock and a whole evening's
// auctions file under the previous day. Naive input passes through untouched.
const withIstDate = <T extends { auctionDate?: string }>(rows: T[]): T[] =>
  rows.map((r) => (r.auctionDate ? { ...r, auctionDate: toIstNaive(r.auctionDate) } : r));

export const addAuction = (
  auctions: AddAuctionDto[],
  deviceId: string
) =>
  repo.addAuction(withIstDate(auctions), deviceId);

export async function generateLedger(
  startDate: string,
  endDate?: string
) {
  const rows = await repo.generateAuctionLedger(startDate, endDate ?? startDate);

  const vasuliList = (rows ?? []).map((r: any) => ({
    partyId: r.partyid,
    partyName: r.partyname,
    openingAmount: r.openingbalance,
    dayBill: r.daybill,
    closingAmount: r.closingbalance,
    vyapariIdNo: r.vyapariidno,
  }));

  const openingAmountSum = vasuliList.reduce((s: number, v: any) => s + (Number(v.openingAmount) || 0), 0);
  const closingAmountSum = vasuliList.reduce((s: number, v: any) => s + (Number(v.closingAmount) || 0), 0);
  // the day's total business across every vyapari
  const sum = vasuliList.reduce(
    (s: number, v: any) => s + (v.dayBill ?? []).reduce((a: number, b: any) => a + (Number(b) || 0), 0),
    0
  );

  return {
    vasuliList,
    openingAmountSum,
    sum,
    closingAmountSum,
  };
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
  // deviceId: string
) => {
  // await repo.deleteAuctionTransactions(
  //   dto.deleteAuctionTransactionDto
  // );
  // await repo.addAuction(dto.addAuctionDtos, deviceId);
  // same IST normalisation as addAuction -- this path recreates auction rows
  await repo.editAuction({ ...dto, addAuctionDtos: withIstDate(dto.addAuctionDtos) });
};

export const markTransactionValidated = (
  fromDate: string,
  toDate: string,
  vyapariId: string
) =>
  repo.markTransactionValidated(fromDate, toDate, vyapariId);
