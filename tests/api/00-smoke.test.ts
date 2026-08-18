import { describe, expect, it } from 'vitest';
import { api, today } from './helpers/client';

const d = today();

describe('smoke: response envelope contract', () => {
  it('GET /item/listItems returns 200 with the CommonApiResponse envelope', async () => {
    const r = await api.get('/item/listItems');
    expect(r.status).toBe(200);
    expect(r.body.responseCode).toBe('200');
    expect(r.body.responseMessage).toBe('Success');
    expect(Array.isArray(r.body.responseBody)).toBe(true);
  });

  it('unknown route returns the routeNotFound envelope', async () => {
    const r = await api.get('/item/definitely-not-a-route');
    expect(r.status).toBe(404);
    expect(r.body.responseCode).toBe('404');
  });

  it('validation failure returns a 400 envelope', async () => {
    const r = await api.get('/party/getPartyById');
    expect(r.status).toBe(400);
    expect(r.body.responseCode).toBe('400');
  });

  it.each([
    ['/party/listAllParties'],
    ['/device/listDevices'],
    ['/vyapari/pending-vasuli'],
    [`/vyapari/vasuli-list?startDate=${d}&endDate=${d}`],
    [
      `/auction/list-auction-transaction?startDate=${encodeURIComponent(`${d} 00:00:00`)}&endDate=${encodeURIComponent(`${d} 23:59:59`)}`,
    ],
  ])('GET %s wraps success in the standard envelope', async (path) => {
    const r = await api.get(path);
    expect(r.status).toBe(200);
    expect(r.body.responseCode).toBe('200');
    expect(r.body.responseMessage).toBe('Success');
    expect(r.body).toHaveProperty('responseBody');
  });
});

describe('smoke: unmatched sub-routes return routeNotFound in every domain', () => {
  const domains = ['/party', '/item', '/device', '/vyapari', '/auction', '/bills'];
  const methods = ['GET', 'POST', 'PUT', 'PATCH'] as const;

  const callers = {
    GET: (p: string) => api.get(p),
    POST: (p: string) => api.post(p, {}),
    PUT: (p: string) => api.put(p, {}),
    PATCH: (p: string) => api.patch(p, {}),
  };

  it.each(domains.flatMap((dom) => methods.map((m) => [m, `${dom}/no-such-endpoint`] as const)))(
    '%s %s -> 404',
    async (method, path) => {
      const r = await callers[method](path);
      expect(r.status).toBe(404);
    },
  );
});

describe('smoke: malformed and missing JSON bodies', () => {
  it.each([
    ['POST', '/party'],
    ['PUT', '/vyapari/edit-vasuli'],
    ['POST', '/item/createItem'],
    ['POST', '/party/vasuliTrasaction'],
  ])('%s %s with malformed JSON -> 400 Invalid JSON body', async (method, path) => {
    const caller = method === 'PUT' ? api.put : api.post;
    const r = await caller(path, undefined, { rawBody: '{"unclosed": ' });
    expect(r.status).toBe(400);
    expect(r.body.responseCode).toBe('400');
  });

  it.each([
    ['POST', '/party'],
    ['POST', '/item/createItem'],
    ['PUT', '/vyapari/edit-vasuli'],
  ])('%s %s with no body at all -> 400', async (method, path) => {
    const caller = method === 'PUT' ? api.put : api.post;
    const r = await caller(path);
    expect(r.status).toBe(400);
  });
});
