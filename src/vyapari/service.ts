import * as repo from './vyapari.repo';

export const generateBill = (vyapariId: string, date: string) =>
  repo.generateBill(vyapariId, date);

export const generateLedger = (
  vyapariId: string,
  startDate: string,
  endDate: string,
  filterOutNonValidated: boolean
) =>
  repo.generateLedger(
    vyapariId,
    startDate,
    endDate,
    filterOutNonValidated
  );

export const getLedgerList = (
  vyapariIds: string[],
  startDate: string,
  endDate: string
) =>
  repo.getLedgerList(vyapariIds, startDate, endDate);

export const listAllVyapariLedger = (startDate: string, endDate: string) =>
  repo.listAllVyapariLedger(startDate, endDate);

export const getVasuliList = (startDate: string, endDate: string) =>
  repo.getVasuliList(startDate, endDate);

export const editVasuli = (vasuli: any) =>
  repo.editVasuli(vasuli);

export const getPendingVasuli = (showToday: boolean) =>
  repo.getPendingVasuli(showToday);

export const notifyVasuli = (dto: any) =>
  repo.notifyVasuli(dto);
