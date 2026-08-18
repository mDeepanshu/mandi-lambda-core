const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';

export default async function globalSetup() {
  try {
    // First request cold-bundles the lambda under serverless-offline — allow 15s.
    const res = await fetch(`${BASE}/item/listItems`, { signal: AbortSignal.timeout(15_000) });
    if (res.status >= 500) throw new Error(`health check returned ${res.status}`);
  } catch (e) {
    throw new Error(
      `API not reachable at ${BASE}. Start it first in another terminal:\n  npm run offline\n(${e})`,
    );
  }
}
