import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { badRequest, unauthorized } from '../common/error';
import { fetchDeviceStatus } from '../device/device.repo';

// Port of the old server's DeviceIdFilter, which guarded every /auction route:
// no deviceId header -> 400, a device that is not APPROVED (or not a device id
// at all) -> 401. Approval is cached per warm container for a minute so the
// check costs one query per device, not one per request; a revoked device is
// shut out within that minute.
const APPROVED_TTL_MS = 60_000;
const approvedUntil = new Map<string, number>();

export async function requireApprovedDevice(event: APIGatewayProxyEventV2): Promise<void> {
  const header = Object.entries(event.headers ?? {}).find(([k]) => k.toLowerCase() === 'deviceid')?.[1]?.trim();
  if (!header) {
    // see auctionDeviceHeaderOptional in serverless.ts (old-server mirror)
    if (process.env.AUCTION_DEVICE_HEADER_OPTIONAL === 'true') return;
    throw badRequest('Missing deviceId in request header');
  }

  if ((approvedUntil.get(header) ?? 0) > Date.now()) return;

  const status = /^\d+$/.test(header) ? await fetchDeviceStatus(Number(header)) : null;
  if (status !== 'APPROVED') throw unauthorized('Invalid deviceId');

  approvedUntil.set(header, Date.now() + APPROVED_TTL_MS);
}
