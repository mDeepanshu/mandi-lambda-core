const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';

export interface Envelope<T = unknown> {
  responseCode: string;
  responseMessage: string;
  responseBody?: T;
}

export interface ApiResult<T = unknown> {
  status: number;
  body: Envelope<T>;
}

interface CallOpts {
  body?: unknown;
  /**
   * deviceid header. Every /auction route requires an APPROVED device (the old
   * server's DeviceIdFilter), so those default to the seeded test device;
   * pass null to send no header at all.
   */
  deviceId?: number | string | null;
  headers?: Record<string, string>;
  /** Send this exact string as the body instead of JSON-serializing `body`. */
  rawBody?: string;
}

async function call<T>(method: string, path: string, opts: CallOpts = {}): Promise<ApiResult<T>> {
  let deviceId = opts.deviceId;
  if (deviceId === undefined && path.startsWith('/auction')) {
    // lazy: seed.ts imports this module, and only calls non-/auction routes
    const { getSeed } = await import('./seed');
    deviceId = (await getSeed()).deviceId;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(deviceId != null ? { deviceid: String(deviceId) } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : undefined,
  });
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    body = { responseCode: String(res.status), responseMessage: '<non-JSON body>' };
  }
  return { status: res.status, body };
}

export const api = {
  get: <T = any>(p: string, o?: CallOpts) => call<T>('GET', p, o),
  post: <T = any>(p: string, body?: unknown, o?: CallOpts) => call<T>('POST', p, { ...o, body }),
  put: <T = any>(p: string, body?: unknown, o?: CallOpts) => call<T>('PUT', p, { ...o, body }),
  patch: <T = any>(p: string, body?: unknown, o?: CallOpts) => call<T>('PATCH', p, { ...o, body }),
  del: <T = any>(p: string, body?: unknown, o?: CallOpts) => call<T>('DELETE', p, { ...o, body }),
};

/** Assert 2xx and return responseBody. */
export function unwrap<T>(r: ApiResult<T>): T {
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(
      `API ${r.status}: ${r.body?.responseMessage} ${JSON.stringify(r.body?.responseBody ?? '')}`,
    );
  }
  return r.body.responseBody as T;
}

/** Local YYYY-MM-DD (the mandi operates in IST; avoid UTC date rollover). */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
