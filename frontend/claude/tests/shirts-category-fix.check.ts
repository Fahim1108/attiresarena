import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {dataSource} from '@/services/adapters';

// Regression: 2026-11-19 live on www.attiresarena.com — /shop showed 22
// admin-published shirts while /category/shirts (nav "All Shirts") showed
// "Coming Soon". Two causes, both fixed here:
//  1. getCategories() counted only the allowlist (thrift) feed, which is
//     empty on production, so shirts.available was false.
//  2. queryProducts() matched categorySlugs:['shirts'] only against the
//     static id "cat-shirts", while admin-published products keep their
//     database category UUID — so even an available shirts page listed 0.
const adminRow={id:'30000000-0000-4000-8000-000000000001',slug:'casual-shirt',name:'Casual shirt',description:'A thrift shirt.',category_id:'40000000-0000-4000-8000-000000000001',highlights:[],tags:[],badges:[],created_at:'2026-11-19T00:00:00Z',published_at:'2026-11-19T00:00:00Z',youtube_video_id:null,seo_title:null,seo_description:null,meta_keywords:null,variants:[{id:'50000000-0000-4000-8000-000000000001',size:'M',color:'Navy',price_minor:45000,sale_price_minor:null,available:1}],media:[{path:'60000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001.jpg',alt:'Casual shirt'}]};
const thriftRow={id:'10000000-0000-4000-8000-000000000001',variant_id:'20000000-0000-4000-8000-000000000001',slug:'aa-shirt-001',name:'Verified physical garment',size:'L',color:'Navy',price_minor:55000,in_stock:true,image_path:'/inventory/thrift-shirts/AA-SHIRT-001-front.jpg',created_at:'2026-10-24T00:00:00Z'};
beforeEach(()=>{vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('CLAUDE_DESIGN_PREVIEW','1');vi.stubEnv('SUPABASE_URL','https://euoannuvovsbwxjqnriw.supabase.co');vi.stubEnv('SUPABASE_PUBLISHABLE_KEY','sb_publishable_isolated_unit_fixture');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function feeds(thrift:unknown[],admin:unknown[]){vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('/rpc/published_thrift_catalogue')?thrift:url.includes('/rpc/published_admin_catalogue')?admin:[]),{status:200})));}
it('shirts is available when only admin-published products exist',async()=>{feeds([],[adminRow]);
 expect((await dataSource.getCategoryBySlug('shirts'))?.available).toBe(true);
 expect((await dataSource.getCategoryBySlug('pants'))?.available).toBe(false);});
it('admin-published shirts list under /category/shirts when the allowlist is empty',async()=>{feeds([],[adminRow]);
 const shirts=await dataSource.getProducts({categorySlugs:['shirts']});
 expect(shirts.items.map(p=>p.id)).toEqual([adminRow.id]);
 expect(shirts.facets.categories.find(c=>c.slug==='shirts')?.count).toBe(1);
 expect(shirts.facets.sizes).toContain('M');
 expect((await dataSource.getProducts({})).total).toBe(1);});
it('a non-shirt category never lists admin-published shirts',async()=>{feeds([],[adminRow]);
 expect((await dataSource.getProducts({categorySlugs:['pants']})).total).toBe(0);
 expect((await dataSource.getProducts({categorySlugs:['sneakers']})).total).toBe(0);});
it('allowlist shirts still list under /category/shirts',async()=>{feeds([thriftRow],[]);
 expect((await dataSource.getCategoryBySlug('shirts'))?.available).toBe(true);
 expect((await dataSource.getProducts({categorySlugs:['shirts']})).items.map(p=>p.id)).toEqual([thriftRow.id]);});
it('a genuinely empty catalogue still shows shirts as coming soon',async()=>{feeds([],[]);
 expect((await dataSource.getCategoryBySlug('shirts'))?.available).toBe(false);
 expect((await dataSource.getCategoryBySlug('shirts'))?.catalogueUnavailable).toBe(false);
 expect((await dataSource.getProducts({categorySlugs:['shirts']})).total).toBe(0);});
it('a failed feed is unavailable, not coming soon',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
 const shirts=await dataSource.getCategoryBySlug('shirts');
 expect(shirts?.available).toBe(false);
 expect(shirts?.catalogueUnavailable).toBe(true);});
