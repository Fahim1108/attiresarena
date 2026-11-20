import {readLiveReviewDrafts,projectSavedReview} from "./live-review-thrift";
import "server-only";
import { placeCheckoutOrder } from "../checkout";
import { isProductionStorefront, reviewInventoryEnabled } from "@/lib/storefront-policy";
import { officialShirtSizeGuide } from "@/config/shirt-size-guide";
import { previewPaymentConfiguration, productionPaymentConfiguration } from "@/config/payment-receiving";
import { unavailableServices } from "./unavailable";
import { customerServices } from "./customer";
import {campaignHero} from '@/config/campaign-banners';
import {reviewShirts} from './review-thrift';
import {publishedShirts,approvedReviews,readPublishedFeed} from './published-thrift';
import {mergeStorefrontFeed} from '@/lib/catalog-publication';
import {toMerchandisingCandidates} from '@/lib/merchandising';

import {storeCategories} from '@/config/catalogue';
import {defaultStorefrontSettings} from '@/config';
import {queryProducts} from '@/lib/catalog-query';
import {getPublishedCategories,mergeDbCategories} from '@/lib/store-settings';
import {availableShirtTypes,publishedAvailable} from '@/lib/catalogue-dimensions';
import type {Category,Product} from '@/types';
import type {StorefrontDataSource} from '../types';

/** Verified publications supersede the matching design-review copy, never duplicate it. The merged list is the allowlist feed UNION published admin products (allowlist wins on collision); feedUnavailable is true only when BOTH feed data calls fail. */
export async function browsableShirtsWithStatus(options:{liveReview?:boolean}={}):Promise<{products:Product[];feedUnavailable:boolean}>{
 const feed=await readPublishedFeed();
 const published=mergeStorefrontFeed(feed.allowlist,feed.published);
 const slugs=new Set(published.map(p=>p.slug));
 let review=reviewInventoryEnabled()?reviewShirts():[];
 if(reviewInventoryEnabled()&&options.liveReview!==false){
  const saved=await readLiveReviewDrafts();
  if(saved!==null)review=saved.filter(item=>item.status!=='archived').flatMap(item=>{
   const base=review.find(p=>p.slug===item.source_id.toLowerCase());
   return base?[projectSavedReview(item,base)]:[];
  });
 }
 return {products:[...published,...review.filter(p=>!slugs.has(p.slug))],feedUnavailable:feed.feedUnavailable};
}
export async function browsableShirts(options:{liveReview?:boolean}={}){
 return (await browsableShirtsWithStatus(options)).products;
}
const categories=storeCategories.map(c=>({...c,available:c.slug==='shirts',description:c.slug==='shirts'?'Individual thrift shirts, carefully selected.':'Coming soon.',...(c.slug==='shirts'?{image:{src:'/images/mockup/category-shirts-check.svg',alt:'Check shirts in white and maroon'},thumbnail:{src:'/images/mockup/category-shirts-check.svg',alt:'Check shirts in white and maroon'}}:{})}));

/** DB-driven categories: published rows override the static config (name, description, photo, banner, SEO, order); the static config is the fallback when the read fails. Static ids are kept by the merge — product filtering keys off them. */
async function liveCategories():Promise<Category[]>{
 return mergeDbCategories(storeCategories,await getPublishedCategories());
}

/** Shirts-only availability + the Shirts photo override, applied on top of the merged list. The adapter photo override always wins for Shirts, even when the DB row has a stored photo. The override image must match the promoted Shirts photo (check-shirts mockup, b994a81) — do not revert it to the old portrait. */
function applyCategoryAvailability(cats:Category[],hasPublished:boolean,catalogueUnavailable:boolean):Category[]{
 return cats.map(c=>({...c,available:c.slug==='shirts'&&hasPublished,catalogueUnavailable,...(c.slug==='shirts'?{image:{src:'/images/mockup/category-shirts-check.svg',alt:'Check shirts in white and maroon'},thumbnail:{src:'/images/mockup/category-shirts-check.svg',alt:'Check shirts in white and maroon'}}:{})}));
}

/** Explicit owner inventory curation. Source order is not represented as a publication timestamp. Real publications sort newest-first by createdAt (the projector's published_at); design-review fixtures keep slug order after them. Featured prefers products badged "Featured Product" in admin; the fixture preview slice remains only when nothing is flagged. */
export function curatedInventoryCollection(products:Product[],kind:'new-arrivals'|'featured'|'best-sellers',limit=8){
 if(kind==='best-sellers')return [];
 const capped=Math.max(0,Math.min(limit,8));
 const fixtures=products.filter(p=>/^aa-shirt-\d{3}$/.test(p.slug)).sort((a,b)=>a.slug.localeCompare(b.slug));
 const real=products.filter(p=>!p.reviewOnly);
 const byRecency=(a:Product,b:Product)=>{
  const pa=Date.parse(a.createdAt); const pb=Date.parse(b.createdAt);
  if(Number.isFinite(pa)&&Number.isFinite(pb)&&pa!==pb)return pb-pa;
  if(Number.isFinite(pa))return -1;
  if(Number.isFinite(pb))return 1;
  return a.slug.localeCompare(b.slug);
 };
 if(kind==='new-arrivals'){
  const ranked=[...real].sort(byRecency);
  const seen=new Set(ranked.map(p=>p.slug));
  return [...ranked,...fixtures.filter(p=>!seen.has(p.slug))].slice(0,capped);
 }
 const flagged=real.filter(p=>p.isFeatured).sort(byRecency);
 return (flagged.length?flagged:fixtures.slice(8)).slice(0,capped);
}
export const ownerCatalogue:StorefrontDataSource={...unavailableServices,...customerServices,
 // Real orders only when the checkout gate opens (staging or production path); otherwise this reports "not connected".
 async placeOrder(payload){return placeCheckoutOrder(payload);},
 async getHomepageProducts(){return toMerchandisingCandidates((await browsableShirtsWithStatus()).products);},
 async getProducts(query={}){
  const {products,feedUnavailable}=await browsableShirtsWithStatus();
  // Category facets resolve slugs through the same DB-driven list the
  // category pages use, so a published DB-only category appears as a
  // filter option. Review mode keeps the static taxonomy (fixtures).
  const cats=reviewInventoryEnabled()?categories:await liveCategories();
  // Provisional preview sizes and visually proposed metadata never satisfy verified facets.
  const requiresVerified=Boolean(query.sizes?.length||query.shirtType||query.collection);
  const verified=products.filter(p=>!p.reviewOnly&&publishedAvailable(p));
  const result=queryProducts(requiresVerified?verified:products,cats,[],query);
  const sizes=queryProducts(verified,cats,[],query).facets;
  return {...result,facets:{...result.facets,sizes:sizes.sizes,sizeLabels:sizes.sizeLabels},catalogueUnavailable:feedUnavailable};
 },
 async getProductBySlug(slug){return (await browsableShirts()).find(p=>p.slug===slug)??null;},
 async getProductsByIds(ids){return (await browsableShirts()).filter(p=>ids.includes(p.id));},
 async getRelatedProducts(){return [];},
 async getCollection(kind,limit=8){return curatedInventoryCollection(await browsableShirts(),kind,limit);},
 async searchSuggestions(term,limit=6){return (await browsableShirts()).filter(p=>p.name.toLowerCase().includes(term.toLowerCase())).slice(0,limit).map(p=>({slug:p.slug,name:p.name,price:p.price,image:p.defaultImages[0]!,categoryName:'Shirts'}));},
 async getBrands(){return [];},async getBrandBySlug(){return null;},
 async getReviews(id){
  // Merged published feed (allowlist UNION admin-published): reviews
  // for admin-published products must display too. Design-review
  // fixtures (reviewOnly, non-UUID ids) are not in the merged feed,
  // so they still yield []. Non-published ids yield [].
  const feed=await readPublishedFeed();
  return mergeStorefrontFeed(feed.allowlist,feed.published).some(p=>p.id===id)?approvedReviews(id):[];
 },async getInitialCart(){return [];},
 async getCategories(){
  if(reviewInventoryEnabled())return categories;
  // Shirts availability reflects the whole browsable catalogue
  // (allowlist UNION admin-published), the same list /shop and the
  // homepage render — not the allowlist alone. The allowlist is empty
  // on production while admin-published shirts are live, which left
  // /category/shirts on "Coming Soon" while /shop showed 22 products.
  // feedUnavailable is true only when BOTH feed sources fail, exactly
  // as browsableShirtsWithStatus reports it.
  const {products,feedUnavailable}=await browsableShirtsWithStatus();
  const hasPublished=products.length>0;
  // DB-driven categories merged over the static config (name,
  // description, photo, banner, SEO, order); the Shirts photo
  // override in applyCategoryAvailability still wins for Shirts.
  return applyCategoryAvailability(await liveCategories(),hasPublished,feedUnavailable);
 },async getCategoryBySlug(slug){return (await this.getCategories()).find(c=>c.slug===slug)??null;},
 async getSizeGuide(id){return id==='tops'?officialShirtSizeGuide:null;},
 async getManualPaymentConfiguration(){
  const configuration=previewPaymentConfiguration();
  // Owner decision 2026-11-19: advance payment (TxID + sender number) is
  // required before any order can be placed. Production collects ONLY from
  // owner-set env vars (MANUAL_PAYMENT_*_NUMBER); the hardcoded preview
  // number is never a live receiving account. With no numbers set,
  // collection stays off and no order can be placed. Preview stays
  // fail-closed as before.
  if(isProductionStorefront())return productionPaymentConfiguration(configuration.policy);
  return reviewInventoryEnabled()?configuration:{...configuration,destinations:[],available:false};
 },
 async getHomepageConfiguration(){const s=await this.getStorefrontSettings();return {sections:s.homepage,hero:s.hero,promoBanners:s.promoBanners,valueProps:s.valueProps};},
 async getStorefrontSettings(){
  const verified=(await publishedShirts()).filter(p=>!p.reviewOnly&&publishedAvailable(p));
  const classifications=availableShirtTypes(verified).map(([,slug,label])=>({label,href:`/shop?shirt=${slug}`}));
  const winter=verified.some(p=>p.collectionSlugs?.includes('winter'));
  return {...defaultStorefrontSettings,
   description:'Attires Arena — individual thrift shirts in Bangladesh.',
   commerce:{...defaultStorefrontSettings.commerce,demoCoupons:[]},
   footer:{...defaultStorefrontSettings.footer,columns:defaultStorefrontSettings.footer.columns.map(c=>({...c,links:c.links.filter(l=>l.href!=='/collections/winter'||winter)}))},
   demo:{...defaultStorefrontSettings.demo,seedCart:false,showNotices:false},hero:campaignHero,
   homepage:defaultStorefrontSettings.homepage.map(s=>({...s,productIds:undefined,subtitle:undefined})),
   header:{...defaultStorefrontSettings.header,announcement:{...defaultStorefrontSettings.header.announcement,items:['Thrift Shirts','Carefully Selected','Individual Pieces']},navigation:defaultStorefrontSettings.header.navigation.map(n=>n.label==='Men'?{...n,label:'Shirts',href:'/category/shirts',children:[{label:'All Shirts',href:'/category/shirts'},...classifications,...(winter?[{label:'Winter',href:'/collections/winter'}]:[])]}:n)},
  };
 },
};
