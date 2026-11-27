'use client';
/* Private signed image URLs are deliberately unoptimized and expire shortly. */
/* eslint-disable @next/next/no-img-element */
import {useActionState,useRef,useState} from 'react';
import {editGallery,uploadProductImages} from '@/lib/admin/gallery-actions';
import {compressImageFile,formatBytes} from '../catalog/image-compress';
type Image={id:string;alt_text:string;position:number;url:string|null};
type Target={id:string;updated_at:string};
function TargetFields({target}:{target:Target}){return <><input type="hidden" name="id" value={target.id}/><input type="hidden" name="updated_at" value={target.updated_at}/></>;}
function GalleryImage({image,images,target}:{image:Image;images:Image[];target:Target}){
 const [state,action,pending]=useActionState(editGallery,{});
 const previous=images.findIndex(i=>i.id===image.id);
 const cover=[image.id,...images.filter(i=>i.id!==image.id).map(i=>i.id)];
 return <article className="aa-panel">{image.url?<img src={image.url} alt={image.alt_text||'Private product photo'} width={240} height={240} loading='lazy' style={{objectFit:'contain',maxWidth:'100%'}}/>:<p>Image preview unavailable. Reload to request a fresh private URL.</p>}
 <form action={action} className="aa-form"><TargetFields target={target}/><input type="hidden" name="image_id" value={image.id}/><input type="hidden" name="ids" value={JSON.stringify(cover)}/>
 <label>Image description<input name="alt" defaultValue={image.alt_text} maxLength={300}/></label>
 <div className="aa-editor-actions"><button name="operation" value="alt" disabled={pending}>Save image description</button>{previous>0&&<button name="operation" value="reorder" disabled={pending}>Make cover image</button>}<button name="operation" value="remove" disabled={pending}>Remove from gallery</button></div>
 {previous===0&&<p>Cover image</p>}{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}
 </form><GalleryOrder image={image} images={images} target={target}/></article>;
}
function GalleryOrder({image,images,target}:{image:Image;images:Image[];target:Target}){
 const [state,action,pending]=useActionState(editGallery,{});const index=images.findIndex(i=>i.id===image.id);
 function moved(delta:number){const ids=images.map(i=>i.id);const current=ids[index],other=ids[index+delta];if(current&&other){ids[index]=other;ids[index+delta]=current;}return JSON.stringify(ids);}
 return <form action={action}><TargetFields target={target}/><input type="hidden" name="operation" value="reorder"/><div className="aa-editor-actions">{index>0&&<button name="ids" value={moved(-1)} disabled={pending}>Move earlier</button>}{index<images.length-1&&<button name="ids" value={moved(1)} disabled={pending}>Move later</button>}</div>{state.error&&<p role="alert">{state.error}</p>}</form>;
}
export function ProductGalleryEditor({target,images}:{target:Target;images:Image[]}){
 const [state,action,pending]=useActionState(uploadProductImages,{});
 // Auto-compression is always on (owner decision 2026-11-27): no
 // toggle. Files are compressed in the browser before submit and the
 // input's files are replaced, so the server only ever sees the
 // compressed bytes. Submits are blocked while compression runs.
 const [compressing,setCompressing]=useState(false);
 const [compressNote,setCompressNote]=useState<string|null>(null);
 const inputRef=useRef<HTMLInputElement|null>(null);
 async function onFilesChange(files: FileList | null) {
  const input=inputRef.current;
  if(!files || files.length===0 || !input) return;
  setCompressing(true);
  try {
   const transfer=new DataTransfer();
   let compressedCount=0;
   for (const file of Array.from(files)) {
    const result=await compressImageFile(file);
    if(result.compressed) compressedCount+=1;
    transfer.items.add(result.file);
   }
   input.files=transfer.files;
   setCompressNote(compressedCount>0?`${compressedCount} image${compressedCount>1?'s':''} compressed before upload (${formatBytes(Array.from(files).reduce((n,f)=>n+f.size,0))} → ${formatBytes(Array.from(transfer.files).reduce((n,f)=>n+f.size,0))}).`:null);
  } finally { setCompressing(false); }
 }
 return <section className="aa-panel"><h2>Private product gallery</h2><p>{images.length}/20 images. Gallery changes remain unpublished.</p>
 <form action={action} className="aa-form" onSubmit={(e)=>{if(compressing)e.preventDefault();}}><TargetFields target={target}/><label>Product images<input ref={inputRef} type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple required disabled={pending||compressing} onChange={(e)=>{void onFilesChange(e.target.files);}}/></label><p>Up to 8 JPEG, PNG or WebP images; 768 KiB combined per upload. Images are compressed automatically before upload.</p>{compressNote&&<p role="status">{compressNote}</p>}<button disabled={pending||compressing}>{pending?'Uploading images…':compressing?'Compressing images…':'Upload product images'}</button>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>
 <div className="aa-gallery">{images.map(image=><GalleryImage key={image.id} image={image} images={images} target={target}/>)}</div>
 </section>;
}
