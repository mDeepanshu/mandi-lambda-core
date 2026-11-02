export interface CrateDTO {
  crateId?: number;
  crateName: string;
  isActive?: boolean;
}

interface CrateItem {
  crate_id: number;
  count: number;
}

export interface CrateReturnRequest {
  vyapariId: string;
  date: string; // ISO format (YYYY-MM-DD)
  crates: CrateItem[];
}

export type CrateIssueRequest = CrateReturnRequest;

interface CrateEditItem {
  crate_id: number;
  count: number; // absolute final day total; replaces that crate's manual entries, 0 removes them
}

export interface EditCrateSummaryRequest {
  vyapariId: string;
  date: string; // ISO format (YYYY-MM-DD)
  crates: CrateEditItem[];
}

// counts are sent positive; stored negative on the RETURN rows
export interface EditCrateVasuliRequest extends EditCrateSummaryRequest {
  // reassigns the payload's crate_ids to another vyapari; omit for a plain edit
  newVyapariId?: string;
  // set after the client confirms a 409 preview, to apply the merge
  confirmMerge?: boolean;
}

export interface CrateVasuliMergeConflict {
  crate_id: number;
  crate_name: string;
  existing_count: number;
  incoming_count: number;
  merged_count: number;
}

export interface EditCrateAuctionEntryRequest {
  id: number; // crate_transaction row id, from GET /crate/auction-list
  crate_id: number;
  count: number; // absolute new count; 0 deletes the entry
}

export interface EditCrateEntryRequest {
  id: number; // crate_transaction row id: entries[].id from /crate/summary, or id from /crate/ledger
  crate_id: number;
  count: number; // absolute crate count, positive for returns too; 0 deletes the entry
}