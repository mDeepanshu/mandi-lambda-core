import * as repo from './auction.repo';
import { toIstNaive, utcToIstNaive } from '../common/datetime';
import { auditOwed, vyapariIdsOfTransactions } from '../common/owed-audit';
import { logger } from '../common/logger';
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

// Each lot's auctionDate is the time that lot was entered. The DB stores it on
// auction_transaction.auction_date, and the list sorts rows by it. The auction
// app (POST /auction) sends it as UTC without the "Z", so it is read as UTC.
// The edit dialog (PATCH /auction/edit-auction) sends IST wall-clock instead,
// so that path uses withIstDate's rule for its lots, not this one.
const withIstLotDates = (auctions: AddAuctionDto[]): AddAuctionDto[] =>
  auctions.map((a) => ({
    ...a,
    buyItems: (a.buyItems ?? []).map((b: any) =>
      b?.auctionDate ? { ...b, auctionDate: utcToIstNaive(b.auctionDate) } : b
    ),
  }));

const withIstLotDatesAsIst = (auctions: AddAuctionDto[]): AddAuctionDto[] =>
  auctions.map((a) => ({ ...a, buyItems: withIstDate((a.buyItems ?? []) as any[]) }));

const buyerIds = (auctions: AddAuctionDto[]) =>
  auctions.flatMap((a) => (a.buyItems ?? []).map((b) => (b as { vyapariId?: string }).vyapariId));

// One `true` per saved auction, the old server's response. The RPC is
// all-or-nothing, so reaching the map means every auction is saved -- either
// by this call or by an earlier attempt of the same request (a retry).
export async function addAuction(
  auctions: AddAuctionDto[],
  deviceId: string
) {
  const result = await auditOwed('auction create', buyerIds(auctions), () =>
    repo.addAuction(withIstLotDates(withIstDate(auctions)), deviceId)
  );
  if (result?.alreadySaved) {
    // a retry or a second tab re-posting the queue; nothing was duplicated
    logger.info('Auction create skipped lots already saved', {
      deviceId,
      created: result.created,
      alreadySaved: result.alreadySaved,
    });
  }
  return auctions.map(() => true);
}

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

// old vyapari (looked up) and new vyapari: a reassignment moves money between them
export const editAuctionTransaction = (
  dto: EditAuctionTransactionDTO
) =>
  auditOwed(
    'auction transaction edit',
    vyapariIdsOfTransactions([dto.auctionTransactionId]).then((ids) => [...ids, dto.vyapariId]),
    () => repo.editAuctionTransaction(dto)
  );

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
  auditOwed('auction transaction delete', vyapariIdsOfTransactions(dto.auctionTransactionIds), () =>
    repo.deleteAuctionTransactions(dto)
  );

// deviceId (the header) is the device of any recreated auction that does not
// name its own, as on the old server's addAuction
export const editAuction = async (
  dto: EditAuctionDTO,
  deviceId: string
) => {
  // same IST normalisation as addAuction -- this path recreates auction rows
  await auditOwed(
    'auction edit (delete + re-add)',
    vyapariIdsOfTransactions(dto.deleteAuctionTransactionDto.auctionTransactionIds).then((ids) => [
      ...ids,
      ...buyerIds(dto.addAuctionDtos),
    ]),
    () =>
      repo.editAuction(
        { ...dto, addAuctionDtos: withIstLotDatesAsIst(withIstDate(dto.addAuctionDtos)) },
        deviceId
      )
  );
};

export async function markTransactionValidated(
  fromDate: string,
  toDate: string,
  vyapariId: string | undefined,
  bulk: boolean
) {
  if (bulk) return repo.markBulkTransactionValidated(fromDate, toDate);
  // the old server ran `vyapari_id = NULL` here: matches nothing
  if (!vyapariId) return 0;
  return repo.markTransactionValidated(fromDate, toDate, vyapariId);
}
