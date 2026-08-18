import { api, unwrap } from './client';

// Fixed names + deterministic party_ids so re-runs reuse the same rows.
export const NAMES = {
  vyapariA: 'TEST_VYAPARI_AUTO_A',
  vyapariB: 'TEST_VYAPARI_AUTO_B',
  kisan: 'TEST_KISAN_AUTO',
  item: 'TEST_ITEM_AUTO',
  device: 'TEST_DEVICE_AUTO',
} as const;

export interface Seed {
  vyapariAId: string;
  vyapariBId: string;
  kisanId: string;
  itemId: string;
  deviceId: number;
}

let seedPromise: Promise<Seed> | undefined;
export const getSeed = (): Promise<Seed> => (seedPromise ??= build());

const pick = (obj: any, ...keys: string[]) => {
  for (const k of keys) if (obj?.[k] != null) return obj[k];
  return undefined;
};

async function findOrCreateParty(type: 'KISAN' | 'VYAPARI', name: string): Promise<string> {
  const list = unwrap<any[]>(await api.get(`/party/listAllParties?partyType=${type}`)) ?? [];
  const hit = list.find((p) => pick(p, 'name', 'partyName', 'party_name') === name);
  if (hit) return String(pick(hit, 'party_id', 'partyId', 'id'));

  const created = unwrap<any[]>(
    await api.post('/party', [
      {
        partyId: `${name}_ID`,
        name,
        contact: type === 'KISAN' ? '9990000003' : name.endsWith('_B') ? '9990000002' : '9990000001',
        partyType: type,
      },
    ]),
  );
  return String(created[0].party_id);
}

async function build(): Promise<Seed> {
  const vyapariAId = await findOrCreateParty('VYAPARI', NAMES.vyapariA);
  const vyapariBId = await findOrCreateParty('VYAPARI', NAMES.vyapariB);
  const kisanId = await findOrCreateParty('KISAN', NAMES.kisan);

  const items = unwrap<any[]>(await api.get('/item/listItems')) ?? [];
  let item = items.find((i) => i.name === NAMES.item);
  if (!item) {
    const created = unwrap<any[]>(
      await api.post('/item/createItem', [{ itemId: `${NAMES.item}_ID`, name: NAMES.item }]),
    );
    item = Array.isArray(created) ? created[0] : created;
  }
  const itemId = String(pick(item, 'item_id', 'itemId', 'id'));

  const devices =
    unwrap<any[]>(await api.get('/device/listDevices?status=REQUESTED,REJECTED,APPROVED')) ?? [];
  let device = devices.find((d) => d.name === NAMES.device);
  if (!device) {
    device = unwrap<any>(await api.post('/device/register', { name: NAMES.device }));
    if (Array.isArray(device)) device = device[0];
  }
  const deviceId = Number(pick(device, 'id', 'device_id', 'deviceId'));
  // No transition guard on device status — self-approve so auction POSTs accept the header.
  unwrap(await api.put(`/device/${deviceId}/status?status=APPROVED`));

  return { vyapariAId, vyapariBId, kisanId, itemId, deviceId };
}
