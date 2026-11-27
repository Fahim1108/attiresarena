import {expect,it,vi,afterEach} from 'vitest';
afterEach(()=>vi.unstubAllEnvs());
import intake from '@/data/inventory/thrift-shirts.json';
import {dataSource} from '@/services/adapters';
it('keeps the 18 supplied physical shirts in draft without invented size or quantity',()=>{expect(intake).toHaveLength(18);expect(new Set(intake.map(i=>i.source_id)).size).toBe(18);expect(new Set(intake.map(i=>i.image_sha256)).size).toBe(18);for(const p of intake){expect(p.stock_quantity).toBe(1);expect(p.actual_size).toBeNull();expect(p.publish_status).toBe('draft');expect(p.size_verified).toBe(false);expect(p.price_minor).toBeGreaterThanOrEqual(50000);expect(p.price_minor).toBeLessThanOrEqual(60000);}});
it('never exposes fictional products, prices, reviews or cart seed through the active adapter when unconfigured',async()=>{for(const key of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])vi.stubEnv(key,'');expect((await dataSource.getProducts()).items).toEqual([]);expect(await dataSource.getProductBySlug('premium-cotton-shirt')).toBeNull();expect(await dataSource.searchSuggestions('cotton')).toEqual([]);expect(await dataSource.getInitialCart()).toEqual([]);expect(await dataSource.getReviews('p001')).toEqual([]);expect(await dataSource.getBrands()).toEqual([]);});
it('keeps future categories configurable and unavailable in review',async()=>{vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('CLAUDE_DESIGN_PREVIEW','1');const categories=await dataSource.getCategories();expect(categories.find(c=>c.slug==='shirts')?.available).toBe(true);
// Hierarchy (owner 2026-11-20, Denim added 2026-11-27): Casual/Formal/Denim/Check live INSIDE Shirts,
// so they are available in review too — only the genuinely future
// top-level categories (Pants, Sneakers, …) stay unavailable.
for(const slug of ['casual-shirt','formal-shirt','denim-shirt','check-shirt'])expect(categories.find(c=>c.slug===slug)?.available).toBe(true);
expect(categories.filter(c=>c.slug!=='shirts'&&!['casual-shirt','formal-shirt','denim-shirt','check-shirt'].includes(c.slug)).every(c=>c.available===false)).toBe(true);});
