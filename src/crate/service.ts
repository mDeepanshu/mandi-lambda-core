import { CrateIssueRequest, CrateReturnRequest, EditCrateAuctionEntryRequest, EditCrateSummaryRequest, EditCrateVasuliRequest } from './crate.model';
import * as repo from './crate.repo';

export async function createCrate(
  crateName: string,
  total: number,
    closingAmount: number
) {
  return await repo.createCrate(crateName, total, closingAmount);
}

export async function getCrates() {
  return await repo.getCrates();
}

export async function getCrateSummaryByDate(p_date: string) {
  return await repo.getCrateSummaryByDate(p_date);
}

export async function editCrateSummary(p_payload: EditCrateSummaryRequest) {
  return await repo.editCrateSummary(p_payload);
}

export async function getCrateSummaryFromLogByDate(p_date: string) {
  return await repo.getCrateSummaryFromLogByDate(p_date);
}

export async function getCrateStockReportByDate(p_date: string) {
  return await repo.getCrateStockReportByDate(p_date);
}

export async function getCrateLedger(p_from_date: string, p_to_date: string, p_vyapari_id: string) {
  return await repo.getCrateLedger(p_from_date, p_to_date, p_vyapari_id);
}

export async function getCrateVasuliSheet(p_date: string) {
  return await repo.getCrateVasuliSheet(p_date);
}

export async function getCrateVasuliList(p_date: string) {
  return await repo.getCrateVasuliList(p_date);
}

export async function editCrateVasuli(p_payload: EditCrateVasuliRequest) {
  return await repo.editCrateVasuli(p_payload);
}

export async function getCrateAuctionList(p_date: string) {
  return await repo.getCrateAuctionList(p_date);
}

export async function editCrateAuctionEntry(p_payload: EditCrateAuctionEntryRequest) {
  return await repo.editCrateAuctionEntry(p_payload);
}

export async function getPendingCrateSummary() {
  return await repo.getPendingCrateSummary();
}

export async function getPendingCratesByVyapari(p_vyapari_id: string) {
  return await repo.getPendingCratesByVyapari(p_vyapari_id);
}

export async function crateReturn(p_payload: CrateReturnRequest) {
  return await repo.crateReturn(p_payload);
}

export async function crateIssue(p_payload: CrateIssueRequest) {
  return await repo.crateIssue(p_payload);
}
