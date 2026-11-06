import * as repo from './vyapari.repo';
import { auditOwed, vyapariIdOfVasuli } from '../common/owed-audit';
import { EditVasuliBodySchemaType, NotifyVasuliBodySchemaType } from './validation';

export const generateBill = (vyapariId: string, date: string) =>
  repo.generateBill(vyapariId, date);

export const generateLedger = (
  vyapariId: string,
  startDate: string,
  endDate: string,
  vyapariApp: boolean
) =>
  repo.generateLedger(vyapariId, startDate, endDate, vyapariApp);

export const getLedgerList = (
  vyapariIds: string[],
  startDate: string,
  endDate: string
) =>
  repo.getLedgerList([...new Set(vyapariIds)], startDate, endDate);

export const listAllVyapariLedger = (startDate: string, endDate: string) =>
  repo.listAllVyapariLedger(startDate, endDate);

export const getVasuliList = (startDate: string, endDate: string) =>
  repo.getVasuliList(startDate, endDate);

// old vyapari (looked up) and new vyapari: a reassignment moves money between them
export const editVasuli = (vasuli: EditVasuliBodySchemaType) =>
  auditOwed(
    'vasuli edit',
    vyapariIdOfVasuli(vasuli.id).then((ids) => [...ids, vasuli.vyapariId]),
    () => repo.editVasuli(vasuli)
  );

export const getPendingVasuli = (showToday: boolean) =>
  repo.getPendingVasuli(showToday);

// VyapariServiceImpl.notifyVasuli: remember what was notified. The old server
// then sent a WhatsApp template; that feature is retired, so nothing is sent.
export async function notifyVasuli(dto: NotifyVasuliBodySchemaType) {
  const amount = Number(dto.message);
  if (dto.vyapariId && dto.message != null && String(dto.message).trim() !== '' && Number.isFinite(amount)) {
    await repo.setLastNotifiedAmount(dto.vyapariId, amount);
  }
  return null;
}
