"use client";
import Image from "next/image";
import { useActionState, useState, useTransition,useSyncExternalStore,useId } from "react";
import { useRouter } from "next/navigation";
import {Mail,LockKeyhole,Eye,EyeOff,ArrowRight} from 'lucide-react';
import {
  requestStaffPasswordReset,
  setNewStaffPassword,
  signInStaff,
  verifyStaffMfa,
  enrollStaffMfa,
} from "@/lib/admin/actions";
import type { AdminActionState } from "@/lib/admin/validation";
const rememberedEmailKey='aa-admin-remembered-email';
function readRememberedEmail(){try{const value=localStorage.getItem(rememberedEmailKey)||'';return value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:'';}catch{return '';}}
function subscribeRememberedEmail(callback:()=>void){window.addEventListener('storage',callback);window.addEventListener('aa-admin-email-change',callback);return ()=>{window.removeEventListener('storage',callback);window.removeEventListener('aa-admin-email-change',callback);};}
function storeRememberedEmail(value:string){try{if(value)localStorage.setItem(rememberedEmailKey,value);else localStorage.removeItem(rememberedEmailKey);window.dispatchEvent(new Event('aa-admin-email-change'));return true;}catch{return false;}}
export function StaffSignIn() {
  const [state, action, pending] = useActionState(signInStaff, {});
  const storedEmail=useSyncExternalStore(subscribeRememberedEmail,readRememberedEmail,()=> '');
  const [typedEmail,setTypedEmail]=useState<string|null>(null);const [remember,setRemember]=useState<boolean|null>(null);
  const [visible,setVisible]=useState(false);const [view,setView]=useState<'signin'|'forgot'>('signin');const [storageError,setStorageError]=useState('');const fieldId=useId();
  const email=typedEmail??storedEmail;const rememberEmail=remember??Boolean(storedEmail);
  if(view==='forgot')return <StaffForgotPassword onBack={()=>setView('signin')} />;
  return (
    <form action={action} className="aa-form aa-login-form" onSubmit={()=>{if(!storeRememberedEmail(rememberEmail?email.trim():''))setStorageError('This browser could not save your email preference. You can still sign in.');}}>
      <div><label htmlFor={fieldId+'-email'}>Email</label><div className="aa-login-input"><Mail size={18} strokeWidth={1.5} aria-hidden="true"/>
        <input
          id={fieldId+'-email'}
          name="email"
          type="email"
          value={email}
          onChange={event=>setTypedEmail(event.target.value)}
          placeholder="name@example.com…"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoComplete="username"
          maxLength={254}
          disabled={pending}
        />
      </div></div>
      <div><label htmlFor={fieldId+'-password'}>Password</label><div className="aa-login-input"><LockKeyhole size={18} strokeWidth={1.5} aria-hidden="true"/>
        <input
          id={fieldId+'-password'}
          name="password"
          type={visible?'text':'password'}
          placeholder="Enter your password…"
          required
          autoComplete="current-password"
          maxLength={256}
          disabled={pending}
        />
        <button type="button" className="aa-login-eye" aria-label={visible?'Hide password':'Show password'} aria-pressed={visible} onClick={()=>setVisible(value=>!value)} disabled={pending}>{visible?<EyeOff size={18} strokeWidth={1.5}/>:<Eye size={18} strokeWidth={1.5}/>}</button>
      </div></div>
      <div className="aa-login-options"><label><input type="checkbox" checked={rememberEmail} onChange={event=>{setTypedEmail(email);setRemember(event.target.checked);if(!event.target.checked&&!storeRememberedEmail(''))setStorageError('Your browser could not clear the email preference.');}}/>Remember email</label><button type="button" className="aa-login-help-trigger" onClick={()=>setView('forgot')}>Forgot password?</button></div>
      {storageError&&<p role="status" className="aa-login-help">{storageError}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      <button className="aa-login-submit" disabled={pending}>
        {pending ? "Signing in…" : <>Sign in securely <ArrowRight size={16} aria-hidden="true"/></>}
      </button>
    </form>
  );
}
/**
 * Staff password-reset request form, shown in place of the sign-in
 * form when "Forgot password?" is pressed. The email is prefilled
 * with the remembered staff email. The reply never reveals whether
 * the email belongs to a staff account — the same message shows
 * either way. The Owner-contact line stays as a secondary fallback.
 */
export function StaffForgotPassword({ onBack }: { onBack: () => void }) {
  const [state, action, pending] = useActionState(requestStaffPasswordReset, {});
  const storedEmail=useSyncExternalStore(subscribeRememberedEmail,readRememberedEmail,()=> '');
  const [typedEmail,setTypedEmail]=useState<string|null>(null);const fieldId=useId();
  const email=typedEmail??storedEmail;
  if (state.success) {
    return (
      <div className="aa-form aa-login-form">
        <p role="status">{state.success}</p>
        <p className="aa-login-help">Still stuck? Contact your store Owner to start the approved account-recovery process. Password recovery does not remove authenticator requirements.</p>
        <button type="button" className="aa-login-submit" onClick={onBack}>Back to sign in</button>
      </div>
    );
  }
  return (
    <form action={action} className="aa-form aa-login-form" onSubmit={()=>{storeRememberedEmail(email.trim());}}>
      <p>Enter your staff email and we will send you a reset link.</p>
      <div><label htmlFor={fieldId+'-email'}>Email</label><div className="aa-login-input"><Mail size={18} strokeWidth={1.5} aria-hidden="true"/>
        <input
          id={fieldId+'-email'}
          name="email"
          type="email"
          value={email}
          onChange={event=>setTypedEmail(event.target.value)}
          placeholder="name@example.com…"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoComplete="username"
          maxLength={254}
          disabled={pending}
        />
      </div></div>
      {state.error && <p role="alert">{state.error}</p>}
      <button className="aa-login-submit" disabled={pending}>
        {pending ? "Sending…" : <>Send reset link <ArrowRight size={16} aria-hidden="true"/></>}
      </button>
      <p className="aa-login-help">Password recovery does not remove authenticator requirements. Never share your password or authenticator codes. Still stuck? Contact your store Owner.</p>
      <button type="button" className="aa-login-help-trigger" onClick={onBack}>Back to sign in</button>
    </form>
  );
}
/**
 * Set-new-password form for /admin/reset-password, reached from the
 * emailed reset link. Client-side only checks that the two entries
 * match; length is enforced server-side. On success the recovery
 * session is already ended, so the visitor signs in again with the
 * new password and authenticator code.
 */
export function StaffResetPassword() {
  const router = useRouter();
  const [state, action, pending] = useActionState(setNewStaffPassword, {});
  const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [visible,setVisible]=useState(false);const [matchError,setMatchError]=useState('');const fieldId=useId();
  if (state.success) {
    return (
      <div className="aa-form aa-login-form">
        <p role="status">{state.success}</p>
        <button type="button" className="aa-login-submit" onClick={()=>router.push('/admin/sign-in')}>Back to sign in</button>
      </div>
    );
  }
  return (
    <form action={action} className="aa-form aa-login-form" onSubmit={event=>{if(password!==confirm){event.preventDefault();setMatchError('Passwords do not match.');}}}>
      <div><label htmlFor={fieldId+'-password'}>New password</label><div className="aa-login-input"><LockKeyhole size={18} strokeWidth={1.5} aria-hidden="true"/>
        <input
          id={fieldId+'-password'}
          name="password"
          type={visible?'text':'password'}
          value={password}
          onChange={event=>setPassword(event.target.value)}
          placeholder="Enter a new password…"
          required
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          disabled={pending}
        />
        <button type="button" className="aa-login-eye" aria-label={visible?'Hide password':'Show password'} aria-pressed={visible} onClick={()=>setVisible(value=>!value)} disabled={pending}>{visible?<EyeOff size={18} strokeWidth={1.5}/>:<Eye size={18} strokeWidth={1.5}/>}</button>
      </div></div>
      <div><label htmlFor={fieldId+'-confirm'}>Confirm new password</label><div className="aa-login-input"><LockKeyhole size={18} strokeWidth={1.5} aria-hidden="true"/>
        <input
          id={fieldId+'-confirm'}
          type={visible?'text':'password'}
          value={confirm}
          onChange={event=>setConfirm(event.target.value)}
          placeholder="Repeat the new password…"
          required
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          disabled={pending}
        />
      </div></div>
      {matchError && <p role="alert">{matchError}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      <button className="aa-login-submit" disabled={pending}>
        {pending ? "Updating…" : "Set new password"}
      </button>
      <p className="aa-login-help">Use a password of 8–128 characters. After this, sign in with your new password and your authenticator code.</p>
    </form>
  );
}
export function StaffMfa({ factorId }: { factorId?: string }) {
  const [enrollment, setEnrollment] = useState<AdminActionState>({});
  const [enrolling, start] = useTransition();
  const [state, action, pending] = useActionState(verifyStaffMfa, {});
  const id = factorId || enrollment.factorId;
  return (
    <div className="aa-form">
      {!id && (
        <>
          <p>Set up an authenticator app to protect store administration.</p>
          <button
            disabled={enrolling}
            onClick={() =>
              start(async () => setEnrollment(await enrollStaffMfa()))
            }
          >
            {enrolling ? "Preparing…" : "Set up authenticator"}
          </button>
        </>
      )}
      {enrollment.error && <p role="alert">{enrollment.error}</p>}
      {enrollment.qr && (
        <>
          <p>Scan this QR code in your authenticator app. Keep it private.</p>
          <Image
            src={enrollment.qr}
            alt="Private authenticator enrollment QR code"
            width={220}
            height={220}
            unoptimized
          />
        </>
      )}
      {id && (
        <form action={action} className="aa-form">
          <input type="hidden" name="factorId" value={id} />
          <label>
            Authenticator code
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={6}
            />
          </label>
          {state.error && <p role="alert">{state.error}</p>}
          <button disabled={pending}>
            {pending ? "Verifying…" : "Verify and continue"}
          </button>
        </form>
      )}
    </div>
  );
}
