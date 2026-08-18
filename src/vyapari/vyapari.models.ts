// edit_vasuli — return type (vasuli table row)
export interface VasuliDTO {
  id: string;
  amount: number | null;
  date: string;
  vyapari_id: string;
  remark: string | null;
  was_null: boolean | null;
}

// edit_vasuli — input DTO
export interface EditVasuliDto {
  id: string;
  amount?: number;
  date?: string;
  vyapariId?: string;
  remark?: string;
  wasNull?: boolean;
}

// find_ledger_transactions — individual ledger entry
export interface LedgerEntryDTO {
  date: string;       // MM-DD-YYYY
  tv: 'V' | 'T';     // V = auction debit, T = vasuli credit
  cr: number;
  dr: number;
  itemName: string;
  remark: string | null;
}

// find_ledger_transactions — full response
export interface LedgerTransactionResponseDTO {
  partyId: string;
  partyIdNo: string;
  partyName: string;
  ledgerOrder: number;
  deviceName: string | null;
  openingAmount: number | null;
  closingAmount: number;
  closingAmountOfDate: string | null; // date of first unvalidated entry
  ledger: LedgerEntryDTO[];
}

// find_ledger_transactions_list — individual row
export interface LedgerListItemDTO {
  txn_date: string;
  tv: string;
  cr: number;
  dr: number;
  item_name: string;
  remark: string | null;
  vyapari_id: string;
}

// generate_bill_by_vyapari_id_and_date — individual bill line
export interface BillItemDTO {
  auctionTransactionId: string;
  itemName: string;
  bag: number | null;
  chungi: number;
  rate: number;
  quantity: number;
  bagWiseQuantity: string | null;
  bagWiseQuantityArray: number[] | null;
  itemTotal: number;
  auctionDate: string;  // DD-MM-YYYY
  partyName: string;
  deviceName: string;
}

// generate_bill_by_vyapari_id_and_date — full response
export interface GenerateBillResponseDTO {
  currentOutstanding: number;
  billList: BillItemDTO[];
  billTotal: number;
}

// get_pending_vasuli — row (vasuli joined with party)
export interface PendingVasuliDTO {
  id: string;
  amount: number | null;
  date: string;
  vyapari_id: string;
  remark: string | null;
  was_null: boolean | null;
  vyapariId: string;
  lastNotifiedAmount: number | null;
  vyapariName: string;
  idNo: string;
  ledgerOrder: number;
  owedAmount: number;
  contact: string | null;
}

// get_vasuli_list2 — individual vasuli entry
export interface VasuliItemDTO {
  id: string;
  vyapariId: string;
  vyapariName: string;
  amount: number | null;
  date: string;
  remark: string | null;
  idNo: string;
  contact: string | null;
}

// get_vasuli_list2 — full response
export interface VasuliListResponseDTO {
  vasuliList: VasuliItemDTO[];
  totalVasuli: number;
}

// notify_vasuli — RPC params + optional notification template fields
export interface NotifyVasuliDto {
  vyapari_id_param: string;
  amount_param: number;
  name?: string;
  contact?: string;
  message?: string;
  date?: string;
  remark?: string;
  idNo?: string;
  templateName?: string;
}
