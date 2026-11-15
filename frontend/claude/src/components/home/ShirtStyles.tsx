import Link from 'next/link';
import {availableShirtTypes,publishedAvailable} from '@/lib/catalogue-dimensions';
import {applyCatalogPatch,catalogHref} from '@/components/catalog/catalog-url';
import type {ProductQueryInput} from '@/services';
import type {Product} from '@/types';
/** Only verified inventory metadata creates classification links, never a material guess. */
export function ShirtStyles({products=[],query}:{products?:Product[];query?:ProductQueryInput}) {
 const verified=products.filter(p=>!p.reviewOnly && publishedAvailable(p));
 const types=availableShirtTypes(verified);
 const winter=verified.some(p=>p.collectionSlugs?.includes('winter'));
 if(!types.length&&!winter)return null;
 const style='rounded-full border border-line bg-white px-4 py-2 text-sm text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
 // Shirt links compose onto the current filters/sort/search instead of dropping them.
 const hrefFor=(slug:string)=>catalogHref('/shop',applyCatalogPatch(query??{},{shirtType:slug}));
 return <nav aria-label="Shirt styles" className="my-5 flex flex-wrap gap-2">
  {types.map(([,slug,label])=><Link key={slug} href={hrefFor(slug)} className={style}>{label}</Link>)}
  {winter&&<Link href="/collections/winter" className={style}>Winter</Link>}
 </nav>;
}
