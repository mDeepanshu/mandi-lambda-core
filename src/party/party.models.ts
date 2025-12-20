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
  id: string;
  name: string;
  contact: string;
  maxLoanDays: number;
  partyType: string;
  ledgerOrder?: number;
  kisanType?: string;
}

export interface VasuliRequest {
  vyapariId: string;
  date: string; // ISO string: yyyy-MM-dd HH:mm:ss
  amount: number;
  remark?: string;
}
