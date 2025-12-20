import * as repo from './bill.repo';
import { KisanBill, VyapariBill } from './bill.models';

export const saveKisanBill = (bill: KisanBill) =>
  repo.saveKisanBill(bill);

export const getKisanBillByKisanIdAndDate = (
  kisanId: string,
  billDate: string,
  index: number
) =>
  repo.getKisanBill(kisanId, billDate, index);

export const saveVyapariBill = (bill: VyapariBill) =>
  repo.saveVyapariBill(bill);

export const getVyapariBillByVyapariIdAndDate = (
  vyapariId: string,
  billDate: string,
  index: number
) =>
  repo.getVyapariBill(vyapariId, billDate, index);

export const autoSaveBills = () =>
  repo.autoSaveBills();
