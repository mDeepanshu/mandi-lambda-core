export interface KisanBillResponseDTO {
  auctionTransactionId: string;
  parentId?: string;
  itemName: string;
  rate: number;
  quantity: number;
  bag: number;
  itemTotal: number;
  auctionDate: string; // ISO date
  partyName: string;
}

export interface KisanBillDTO {
  billId?: number;
  mandiKharcha?: number;
  hammali?: number;
  nagarPalikaTax?: number;
  nagarPalikaTaxRate?: number;
  bhada?: number;
  driver?: number;
  nagdi?: number;
  commission?: number;
  commissionRate?: number;
  bills?: KisanBillResponseDTO[][];
  summaryBills?: KisanBillResponseDTO[];
  kisanId?: string;
  kisanName?: string;
}

export interface KisanBillPaymentResponseDTO {
  kisanBills: KisanBillDTO[];
  kacchaTotal: number;
  commission: number;
  hammali: number;
  bhada: number;
  nagarPalikaTax: number;
  nagdi: number;
  mandiKharcha?: number;
  driver?: number;
  pakkaTotal?: number;
}
