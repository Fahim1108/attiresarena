"use client";
export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="aa-auth">
      <h1>Administration unavailable</h1>
      <p>
        Something went wrong while loading this page. If you just saved a
        change, check the relevant list before saving again — the change
        may have been saved even though this page did not load. Retry or
        sign in again.
      </p>
      <button type="button" onClick={reset}>Retry</button>
      <a href="/admin/sign-in">Staff sign-in</a>
    </main>
  );
}
