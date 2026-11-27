'use client';
import {useActionState,useRef,useState} from 'react';
import {uploadDraftMedia,type MediaUploadState} from '@/lib/admin/media-actions';
import {compressImageFile,formatBytes} from '../catalog/image-compress';
export function DraftMediaForm(){
 const [state,action,pending]=useActionState<MediaUploadState,FormData>(uploadDraftMedia,{});
 // Auto-compression is always on (owner decision 2026-11-27): no
 // toggle. The file is compressed in the browser before submit and
 // the input's file is replaced. Submits are blocked while it runs.
 const [compressing,setCompressing]=useState(false);
 const [compressNote,setCompressNote]=useState<string|null>(null);
 const inputRef=useRef<HTMLInputElement|null>(null);
 async function onFileChange(files: FileList | null) {
  const file=files?.[0];
  const input=inputRef.current;
  if(!file || !input) return;
  setCompressing(true);
  try {
   const result=await compressImageFile(file);
   if(result.compressed){
    const transfer=new DataTransfer();
    transfer.items.add(result.file);
    input.files=transfer.files;
    setCompressNote(`Compressed ${formatBytes(file.size)} → ${formatBytes(result.file.size)} before upload.`);
   } else {
    setCompressNote(result.note);
   }
  } finally { setCompressing(false); }
 }
 return <form action={action} className="aa-form" onSubmit={(e)=>{if(compressing)e.preventDefault();}}>
  <label>Private draft image<input ref={inputRef} type="file" name="image" accept="image/jpeg,image/png,image/webp" required disabled={pending||compressing} onChange={(e)=>{void onFileChange(e.target.files);}}/></label>
  <p>JPEG, PNG or WebP, up to 768 KiB. Stored privately; this does not publish or attach an image to a product. Images are compressed automatically before upload.</p>
  {compressNote&&<p role="status">{compressNote}</p>}
  <button disabled={pending||compressing}>{pending?'Uploading…':compressing?'Compressing…':'Upload private image'}</button>
  {state.error&&<p role="alert">{state.error}</p>}
  {state.path&&<div role="status"><p>Private image uploaded.</p><label>Stored object path<input readOnly value={state.path}/></label></div>}
 </form>;
}
