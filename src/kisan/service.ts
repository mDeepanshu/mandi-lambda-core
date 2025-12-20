import * as repo from './kisan.repo';
import {
  KisanBillDTO,
  KisanBillResponseDTO,
  KisanBillPaymentResponseDTO,
} from './kisan.models';

export async function generateBill(
  kisanId: string,
  date: string
): Promise<KisanBillDTO> {
  const bills = await repo.fetchBillTransactions(kisanId, date);
  const grouped = groupBillsByParentId(bills);
  return { bills: grouped };
}

export async function saveBill(
  kisanId: string,
  date: string,
  dto: KisanBillDTO
) {
  return repo.saveBill(kisanId, date, dto);
}

export async function kisanBillPaymentSummary(
  startDate?: string,
  endDate?: string,
  listLive = false
): Promise<KisanBillPaymentResponseDTO> {
  return repo.fetchKisanBillSummary(startDate, endDate, listLive);
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
