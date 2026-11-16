'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { User } from 'lucide-react';
import { signOutCustomer } from '@/lib/customer/actions';

/**
 * Header account menu. Signed-in state comes only from a verified
 * customer session (read server-side and passed down as props) — never
 * a pretend menu. Signed out, it links to sign-in / registration.
 */
export function CustomerMenu({ signedIn = false, displayName }: { signedIn?: boolean; displayName?: string }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!detailsRef.current?.contains(e.target as Node)) detailsRef.current?.removeAttribute('open');
    };
    const onKey = (e: KeyboardEvent) => {
      const details = detailsRef.current;
      if (e.key === 'Escape' && details?.open) {
        details.removeAttribute('open');
        details.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const firstName = displayName?.trim().split(' ')[0];
  const links: (readonly [string, string])[] = signedIn
    ? [['My Account', '/account'], ['My Orders', '/account/orders'], ['Addresses', '/account/addresses'], ['Wishlist', '/wishlist']]
    : [['Sign In', '/account/login'], ['Create Account', '/account/register'], ['My Account', '/account'], ['My Orders', '/account/orders'], ['Wishlist', '/wishlist']];
  return <details ref={detailsRef} className="group/account relative hidden sm:block">
    <summary aria-label="Account menu" className="aa-press flex min-h-11 min-w-8 cursor-pointer list-none flex-col items-center justify-center gap-1 rounded text-ink transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
      <User size={22} strokeWidth={1.5} aria-hidden /><span className="hidden max-w-[88px] truncate text-xs lg:block">{signedIn && firstName ? firstName : 'Account'}</span>
    </summary>
    <nav aria-label="Customer account" className="absolute right-0 top-full z-50 mt-2 w-48 animate-dropdown-in rounded-lg border border-line bg-white p-2 shadow-lift">
      {links.map(([label, href]) => <Link key={href} href={href} onClick={e => e.currentTarget.closest('details')?.removeAttribute('open')} className="block rounded px-3 py-2.5 text-sm hover:bg-selected hover:text-primary">{label}</Link>)}
      {signedIn && (
        <form action={signOutCustomer}>
          <button type="submit" className="block w-full cursor-pointer rounded px-3 py-2.5 text-left text-sm hover:bg-selected hover:text-primary">
            Sign Out
          </button>
        </form>
      )}
    </nav>
  </details>;
}
