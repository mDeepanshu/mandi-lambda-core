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

  const openingAmountSum = (rows ?? []).reduce((s: number, r: any) => s + (Number(r.openingbalance) || 0), 0);
  const closingAmountSum = (rows ?? []).reduce((s: number, r: any) => s + (Number(r.closingbalance) || 0), 0);
  // the day's total business across every vyapari
  const sum = (rows ?? []).reduce(
    (s: number, r: any) => s + (r.daybill ?? []).reduce((a: number, b: any) => a + (Number(b) || 0), 0),
    0
  );

  // dayBill is a comma-joined string ("820,1840", "" when none) to match the
  // legacy API the frontend was built against
  const vasuliList = (rows ?? []).map((r: any) => ({
    partyId: r.partyid,
    partyName: r.partyname,
    openingAmount: r.openingbalance,
    dayBill: (r.daybill ?? []).join(','),
    closingAmount: r.closingbalance,
    vyapariIdNo: r.vyapariidno,
  }));

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

// The RPC returns { itemTotals, auctionTransactions }. Both legacy APIs the
// frontends were built against returned the bare transaction array, so that is
// the default; ?includeItemTotals=true opts into the full object.
export async function listAuctionTransaction(
  startDate: string,
  endDate: string,
  deviceId?: string | null,
  includeItemTotals = false
) {
  const report = await repo.listAuctionTransaction(startDate, endDate, deviceId);
  if (includeItemTotals) {
    return { itemTotals: report?.itemTotals ?? [], auctionTransactions: report?.auctionTransactions ?? [] };
  }
  return report?.auctionTransactions ?? [];
}

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
