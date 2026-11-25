import type { Product } from '@/types';
export const APPAREL_SIZES=['S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL','8XL','9XL','10XL'] as const;
export type ApparelSize=typeof APPAREL_SIZES[number];
export function canonicalSize(value:string):ApparelSize|undefined {
 const normalized=value.trim().toLowerCase().replace(/[-_\s]+/g,' ');
 return ({s:'S',m:'M',l:'L',xl:'XL',xxl:'2XL','2xl':'2XL',xxxl:'3XL','3xl':'3XL',xxxxl:'4XL','4xl':'4XL',xxxxxl:'5XL','5xl':'5XL',xxxxxxl:'6XL','6xl':'6XL',xxxxxxxl:'7XL','7xl':'7XL',xxxxxxxxl:'8XL','8xl':'8XL',xxxxxxxxxl:'9XL','9xl':'9XL',xxxxxxxxxxl:'10XL','10xl':'10XL'} as Record<string,ApparelSize>)[normalized];
}
export const SHIRT_CLASSIFICATIONS=[
 ['pattern','solid','Solid'],['pattern','striped','Striped'],['pattern','checked','Checked / Plaid'],['pattern','printed','Printed'],
 ['occasion','formal','Formal'],['occasion','casual','Casual'],
 ['fabric','denim','Denim'],['fabric','oxford','Oxford'],['fabric','flannel','Flannel'],['fabric','linen','Linen'],
 ['design','overshirt','Overshirt'],['design','cuban-collar','Cuban Collar'],
 ['sleeve','short-sleeve','Short Sleeve'],['sleeve','long-sleeve','Long Sleeve'],
] as const;
export type ShirtDimension=typeof SHIRT_CLASSIFICATIONS[number][0];
export type ShirtClassification=typeof SHIRT_CLASSIFICATIONS[number][1];
export function publishedAvailable(p:Product){return p.status==='published'&&p.variants.some(v=>v.stock>0);}
export function availableApparelSizes(p:Product):ApparelSize[]{
 if(!p.apparelSizing)return [];
 return APPAREL_SIZES.filter(size=>p.variants.some(v=>v.stock>0&&canonicalSize(v.size)===size));
}
export function availableShirtTypes(products:Product[]){return SHIRT_CLASSIFICATIONS.filter(([dimension,value])=>products.some(p=>publishedAvailable(p)&&p.shirtAttributes?.[dimension]?.includes(value)));}
export function sameSizeRecommendations(product:Product,candidates:Product[],selectedSize?:string,limit=6){
 const target=selectedSize?canonicalSize(selectedSize):availableApparelSizes(product).length===1?availableApparelSizes(product)[0]:undefined;
 if(!target||!product.apparelSizing)return [];
 const seen=new Set([product.id]);
 return candidates.filter(p=>{if(seen.has(p.id)||!publishedAvailable(p)||!availableApparelSizes(p).includes(target))return false;seen.add(p.id);return true;})
 .sort((a,b)=>Number(b.categoryId===product.categoryId)-Number(a.categoryId===product.categoryId)).slice(0,limit);
}
