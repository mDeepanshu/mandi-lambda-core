import { expect } from 'vitest';
import { api, unwrap } from './client';

export async function owed(partyId: string): Promise<number> {
  const p = unwrap<any>(await api.get(`/party/getPartyById?partyId=${encodeURIComponent(partyId)}`));
  return Number(p.owed_amount ?? 0);
}

/** Run fn and assert the party's owed_amount moved by exactly `expected`. */
export async function expectOwedDelta(
  partyId: string,
  expected: number,
  fn: () => Promise<unknown>,
): Promise<void> {
  const before = await owed(partyId);
  await fn();
  const after = await owed(partyId);
  expect(after - before).toBeCloseTo(expected, 2);
}
