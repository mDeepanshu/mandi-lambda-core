import * as repo from './kisan.repo';
import {
  KisanBillDTO,
  KisanBillResponseDTO,
  KisanBillPaymentResponseDTO,
} from './kisan.models';

export async function generateBill(
  billId: string
): Promise<any> {
  return repo.fetchBillTransactions(billId);
}

export async function saveBill(
  kisanId: string,
  date: string,
  dto: KisanBillDTO,
) {
  return repo.saveBill(kisanId, date, dto);
}

export async function kisanBillPaymentSummary(
  date: string
): Promise<any> {
  return repo.fetchKisanBillSummary(date);
}

export async function PendingItemsSummary(
  startDate?: string,
  endDate?: string
): Promise<any> {
  return repo.fetchPendingItemsSummary(startDate, endDate);
}

export async function PendingByKisanId(
  kisanId: string
): Promise<any> {
  const summary = await repo.fetchPendingByKisanId(kisanId);
  return summary;
}

/* ---------- helper (ported from Java) ---------- */

function groupBillsByParentId(
  bill: KisanBillResponseDTO[]
): KisanBillResponseDTO[][] {
  const map: Record<string, KisanBillResponseDTO[]> = {};

  for (const tx of bill) {
    const id = tx.parentId ?? tx.auctionTransactionId;
    map[id] = map[id] || [];
    map[id].push(tx);
  }

  return Object.values(map);
}
