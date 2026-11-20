"use client";

import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Pause,Play} from 'lucide-react';
import {SmartImage} from '@/components/ui';
import type {HeroSettings} from '@/types';

/** Controls sit below the artwork so they never obscure contact details or text. */
export function BannerCarousel({hero}:{hero:HeroSettings}) {
  const [index,setIndex]=useState(0);
  const [paused,setPaused]=useState(false);
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  // Bumped on every manual navigation so the autoplay effect below restarts
  // its interval: a manual advance gets a full fresh autoplay window.
  const [cycle,setCycle]=useState(0);
  const touch=useRef<{x:number;y:number}|null>(null);
  const count=hero.slides.length;
  const active=count?index%count:0;
  const go=(delta:number)=>{setCycle(c=>c+1);setIndex(current=>(current+delta+count)%count);};
  const goTo=(i:number)=>{setCycle(c=>c+1);setIndex(i);};
  useEffect(()=>{
    if(count<2||paused||hovered||focused||!hero.autoplayMs)return;
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer:number|undefined;
    const sync=()=>{
      // Start/stop only on a real running-state change: visibility and
      // media events can fire while the timer is already running, and
      // restarting the interval on each one delayed the first advance.
      if(media.matches||document.hidden){window.clearInterval(timer);timer=undefined;return;}
      if(timer!==undefined)return;
      timer=window.setInterval(()=>setIndex(current=>(current+1)%count),hero.autoplayMs);
    };
    sync();media.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
    return ()=>{window.clearInterval(timer);media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
  },[count,paused,hovered,focused,hero.autoplayMs,cycle]);
  if(!count)return null;
  const control='flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-primary transition-colors hover:bg-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
  return <section aria-label="Attires Arena campaigns" aria-roledescription="carousel" className="bg-white"
    onPointerEnter={e=>{if(e.pointerType==='mouse')setHovered(true);}} onPointerLeave={()=>setHovered(false)}
    onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false);}}
    onKeyDown={e=>{if(e.key==='ArrowLeft'){e.preventDefault();go(-1);}if(e.key==='ArrowRight'){e.preventDefault();go(1);}}}>
    {/* The artwork is 16:9 and must stay whole (contact strip along the bottom edge), so the frame matches that ratio: object-contain then fills it edge-to-edge at every width — no side gaps and no crop. The old fixed clamp heights left ~350px white gaps on each side at 1440px. */}
    <div data-banner-frame className="relative mx-auto aspect-video w-full overflow-hidden bg-white [touch-action:pan-y]"
      onTouchStart={e=>{const t=e.touches[0];if(t)touch.current={x:t.clientX,y:t.clientY};}}
      onTouchEnd={e=>{const t=e.changedTouches[0],start=touch.current;touch.current=null;if(!t||!start)return;const dx=t.clientX-start.x,dy=t.clientY-start.y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy))go(dx<0?1:-1);}}
      onTouchCancel={()=>{touch.current=null;}}>
      {hero.slides.map((slide,i)=>{
        // HERO SPEED (Preview 2026-11-21: first banner blank white for
        // seconds): the banners are already .webp, so routing them
        // through the image optimizer only adds an on-demand AVIF
        // transcode that is cold on every fresh Preview deploy — serve
        // the files directly. Mount only the active slide and the next
        // one, so first paint fetches one banner, not all three at
        // once; the next slide stays pre-mounted for smooth autoplay.
        // A manual jump to a non-next slide loads its image on demand.
        const showImage=i===active||i===(active+1)%count;
        return <div key={slide.id} role="group" aria-roledescription="slide" aria-label={`${i+1} of ${count}: ${slide.title}`} aria-hidden={i!==active} inert={i!==active}
        className={`absolute inset-0 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none motion-reduce:translate-x-0 ${i===active?'translate-x-0 opacity-100':'pointer-events-none translate-x-[2%] opacity-0'}`}>
        {showImage && <SmartImage src={slide.image.src} alt={slide.image.alt} fill sizes="100vw" priority={i===0} loading={i===0?undefined:'lazy'} unoptimized className="object-contain" />}
      </div>;})}
    </div>
    {count>1&&<div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2 sm:gap-4">
      <button type="button" className={control} aria-label="Previous banner" onClick={()=>go(-1)}><ChevronLeft size={18} aria-hidden/></button>
      <div className="flex" role="group" aria-label="Choose banner">{hero.slides.map((slide,i)=><button type="button" key={slide.id} className="flex h-11 w-8 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Show banner ${i+1}: ${slide.title}`} aria-current={i===active?'true':undefined} onClick={()=>goTo(i)}><span className={`h-2 w-2 rounded-full ${i===active?'bg-primary':'border border-primary bg-white'}`}/></button>)}</div>
      <button type="button" className={control} aria-label="Next banner" onClick={()=>go(1)}><ChevronRight size={18} aria-hidden/></button>
      {hero.autoplayMs > 0 && <button type="button" className={control} aria-label={paused?'Play banners':'Pause banners'} aria-pressed={paused} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={16} aria-hidden/>:<Pause size={16} aria-hidden/>}</button>}
    </div>}
  </section>;
}
