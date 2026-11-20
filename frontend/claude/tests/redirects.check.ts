import { describe, expect, it } from 'vitest';
import {
  createCachedRedirectConfig,
  fetchRedirectConfig,
  isProtectedPath,
  matchRedirect,
  normalizeRedirectPath,
  parseRedirectConfig,
  resolveStorefrontRedirect,
  type RedirectConfig,
} from '../src/lib/redirects';

const config = (over: Partial<RedirectConfig> = {}): RedirectConfig => ({
  auto: true,
  rules: [
    { source: '/old-shirts', target: '/category/shirts', code: 301 },
    { source: '/deals', target: 'https://example.com/sale', code: 302 },
    { source: '/winter', target: '/collections/winter?ref=redirect', code: 301 },
  ],
  ...over,
});

describe('normalizeRedirectPath', () => {
  it('strips one trailing slash, query strings and hashes; root stays /', () => {
    expect(normalizeRedirectPath('/old-shirts/')).toBe('/old-shirts');
    expect(normalizeRedirectPath('/old-shirts?x=1')).toBe('/old-shirts');
    expect(normalizeRedirectPath('/old-shirts#top')).toBe('/old-shirts');
    expect(normalizeRedirectPath('/')).toBe('/');
    expect(normalizeRedirectPath('')).toBe('/');
  });
});

describe('isProtectedPath', () => {
  it('protects admin, API and framework paths only', () => {
    for (const p of ['/admin', '/admin/orders', '/api', '/api/orders', '/_next/static/x.js', '/_vercel/speed-insights']) {
      expect(isProtectedPath(p)).toBe(true);
    }
    for (const p of ['/shop', '/account', '/auth/sign-in', '/product/shirt', '/administrator']) {
      expect(isProtectedPath(p)).toBe(false);
    }
  });
});

describe('parseRedirectConfig', () => {
  it('parses the RPC payload', () => {
    expect(
      parseRedirectConfig({
        auto: true,
        redirects: [{ source_path: '/a', target_path: '/b', code: 301 }],
      }),
    ).toEqual({ auto: true, rules: [{ source: '/a', target: '/b', code: 301 }] });
  });
  it('rejects malformed payloads instead of inventing redirects', () => {
    expect(parseRedirectConfig(null)).toBeNull();
    expect(parseRedirectConfig({ redirects: [] })).toBeNull();
    expect(parseRedirectConfig({ auto: true, redirects: 'nope' })).toBeNull();
    expect(parseRedirectConfig({ auto: true, redirects: [{ source_path: '/a', target_path: '/b', code: 307 }] })).toBeNull();
    expect(parseRedirectConfig({ auto: true, redirects: [{ source_path: '/a', target_path: '/b' }] })).toBeNull();
  });
});

describe('matchRedirect', () => {
  it('matches exactly, tolerating a trailing slash on either side', () => {
    expect(matchRedirect('/old-shirts', config())).toEqual({ source: '/old-shirts', target: '/category/shirts', code: 301 });
    expect(matchRedirect('/old-shirts/', config())).toEqual({ source: '/old-shirts', target: '/category/shirts', code: 301 });
    expect(matchRedirect('/old-shirts?x=1', config())).toEqual({ source: '/old-shirts', target: '/category/shirts', code: 301 });
  });
  it('returns null when the toggle is off, the path is protected, or nothing matches', () => {
    expect(matchRedirect('/old-shirts', config({ auto: false }))).toBeNull();
    expect(matchRedirect('/admin', config({ rules: [{ source: '/admin', target: '/shop', code: 301 }] }))).toBeNull();
    expect(matchRedirect('/api/orders', config({ rules: [{ source: '/api/orders', target: '/shop', code: 301 }] }))).toBeNull();
    expect(matchRedirect('/nope', config())).toBeNull();
  });
});

describe('resolveStorefrontRedirect', () => {
  it('resolves a site path and preserves the request query', () => {
    expect(resolveStorefrontRedirect('https://www.attiresarena.com/old-shirts?sort=newest', config())).toEqual({
      url: 'https://www.attiresarena.com/category/shirts?sort=newest',
      code: 301,
    });
  });
  it('passes absolute targets through unchanged', () => {
    expect(resolveStorefrontRedirect('https://www.attiresarena.com/deals', config())).toEqual({
      url: 'https://example.com/sale',
      code: 302,
    });
  });
  it('a target with its own query wins over the request query', () => {
    expect(resolveStorefrontRedirect('https://www.attiresarena.com/winter?sort=newest', config())).toEqual({
      url: 'https://www.attiresarena.com/collections/winter?ref=redirect',
      code: 301,
    });
  });
  it('returns null for unmapped paths and malformed URLs', () => {
    expect(resolveStorefrontRedirect('https://www.attiresarena.com/shop', config())).toBeNull();
    expect(resolveStorefrontRedirect('not a url', config())).toBeNull();
  });
});

describe('fetchRedirectConfig', () => {
  const okResponse = (payload: unknown) =>
    ({ ok: true, json: async () => payload }) as Response;
  it('posts to the resolve RPC with the publishable key and parses the payload', async () => {
    const seen: { input: string; init: RequestInit }[] = [];
    const result = await fetchRedirectConfig(
      'https://example.supabase.co/',
      'sb_publishable_test',
      async (input, init) => {
        seen.push({ input, init });
        return okResponse({ auto: true, redirects: [{ source_path: '/a', target_path: '/b', code: 302 }] });
      },
    );
    expect(result).toEqual({ auto: true, rules: [{ source: '/a', target: '/b', code: 302 }] });
    expect(seen).toHaveLength(1);
    const firstCall = seen[0]!;
    expect(firstCall.input).toBe('https://example.supabase.co/rest/v1/rpc/resolve_storefront_redirects');
    expect(firstCall.init.method).toBe('POST');
    const headers = firstCall.init.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_publishable_test');
    expect(headers.Authorization).toBe('Bearer sb_publishable_test');
  });
  it('fails open on non-OK responses, malformed payloads and transport errors', async () => {
    expect(
      await fetchRedirectConfig('https://example.supabase.co', 'k', async () => ({ ok: false, json: async () => null }) as Response),
    ).toBeNull();
    expect(await fetchRedirectConfig('https://example.supabase.co', 'k', async () => okResponse({ auto: 'yes' }))).toBeNull();
    expect(
      await fetchRedirectConfig('https://example.supabase.co', 'k', async () => {
        throw new Error('network down');
      }),
    ).toBeNull();
  });
});

describe('createCachedRedirectConfig', () => {
  it('serves the cached config inside the TTL and refetches after it', async () => {
    let now = 1_000;
    let loads = 0;
    const loader = createCachedRedirectConfig(
      async () => {
        loads += 1;
        return config();
      },
      60_000,
      () => now,
    );
    await loader();
    await loader();
    expect(loads).toBe(1);
    now += 59_999;
    await loader();
    expect(loads).toBe(1);
    now += 1;
    await loader();
    expect(loads).toBe(2);
  });
  it('a failed load returns null without throwing and is cached too', async () => {
    let calls = 0;
    const loader = createCachedRedirectConfig(async () => {
      calls += 1;
      throw new Error('db down');
    });
    expect(await loader()).toBeNull();
    expect(await loader()).toBeNull();
    expect(calls).toBe(1);
  });
});
