export interface NotifyVasuliDto {
  name?: string;
  contact?: string;
  message?: string;
  date?: string;
  remark?: string;
  idNo?: string;
  templateName?: string;
  vyapariId: string;
}

export interface VyapariBillResponseDTO {
  rate: number;
  quantity: number;
  chungi?: number;
}

export interface VyapariBillDTO {
  currentOutstanding: number;
  billList: VyapariBillResponseDTO[][];
}

export interface VasuliListDTO {
  amount?: number;
}

export interface VasuliListResponseDTO {
  vasuliList: VasuliListDTO[];
}
