'use client';
import {useId,useState,useTransition} from 'react';
import {Modal,Button} from '@/components/ui';
import {LoginForm} from '@/components/account/AuthForms';
import {redeemRewardAction} from '@/services/reward-actions';
export function CouponField(){
 const id=useId();const [code,setCode]=useState('');const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null);const [login,setLogin]=useState(false);const [pending,start]=useTransition();
 return <><form onSubmit={e=>{e.preventDefault();if(pending)return;start(async()=>{try{const r=await redeemRewardAction(code);setMessage({ok:r.ok,text:r.message});if(r.reason==='authentication_required')setLogin(true);}catch{setMessage({ok:false,text:'Coupon redemption is unavailable. Please try again.'});}});}}>
 <div className="flex gap-2"><label htmlFor={id} className="sr-only">Coupon code</label><input id={id} name="couponCode" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={80} placeholder="Enter coupon code" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="h-11 min-w-0 flex-1 rounded-control border border-line bg-white px-3 text-sm focus:border-primary"/><Button type="submit" variant="outline" loading={pending}>Apply</Button></div>
 {message&&<p role="status" className={`mt-2 text-xs ${message.ok?'text-success':'text-danger'}`}>{message.text}</p>}
 </form><Modal open={login} onClose={()=>setLogin(false)} title="Sign in to redeem your coupon" description="Your cart and delivery details stay here. You can close this window and continue as a guest."><LoginForm/><Button variant="ghost" fullWidth className="mt-4" onClick={()=>setLogin(false)}>Continue as guest</Button></Modal></>;
}
