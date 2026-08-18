export interface InsertPartyDTO {
  party_id?: string;
  name: string;
  contact: string;
  party_type: 0 | 1;
  owed_amount?: number;
  max_loan_days?: number;
  ledger_order?: number;
  party_code?: string;
}

export interface AddPartyRequest {
  partyId?: string;
  name: string;
  contact: string;
  partyType: string;
  owedAmount?: number;
  maxLoanDays?: number;
  ledgerOrder?: number;
}

export interface Party {
  partyId: string;
  idNo: string;
  contact: string;
  name: string;
  owedAmount: number;
  partyType: number;
  maxLoanDays: number;
  lastVasuliDate: string | null;
  ledgerOrder: number;
  lastNotifiedAmount: number;
  partyCode: string;
  kisanType: string | null;
  commision: number | null;
}

export interface VasuliRequest {
  vyapariId: string;
  date: string; // ISO string: yyyy-MM-dd HH:mm:ss
  amount: number;
  remark?: string;
  was_null?: boolean;
}
