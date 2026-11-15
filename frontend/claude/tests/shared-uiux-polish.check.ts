import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const p = `${dir}/${entry}`;
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Shared + account slice only: other slices own their files and may differ.
const sliceTsx = [
  ...walk('src/components/ui'),
  ...walk('src/components/layout'),
  ...walk('src/components/loading'),
  ...walk('src/components/theme'),
  ...walk('src/components/motion'),
  ...walk('src/components/account'),
  ...walk('src/app/(store)/account'),
  'src/app/layout.tsx',
  'src/app/not-found.tsx',
  'src/app/(store)/layout.tsx',
  'src/app/(store)/loading.tsx',
  'src/app/(store)/error.tsx',
  'src/app/(store)/not-found.tsx',
].filter((p) => p.endsWith('.tsx'));

describe('shared ui/ux polish regressions', () => {
  it('keeps the skip target focusable and the sticky header clear of scrolled content', () => {
    expect(read('src/app/(store)/layout.tsx')).toContain('<main id="main" tabIndex={-1}');
    expect(read('src/app/not-found.tsx')).toContain('<main id="main" tabIndex={-1}');
    expect(read('src/app/globals.css')).toContain('scroll-padding-top: 148px');
    expect(read('src/app/globals.css')).toContain('scroll-padding-top: 112px');
    expect(read('src/app/layout.tsx')).toContain('viewportFit: "cover"');
  });

  it('keeps focus indicators and placeholders at readable contrast', () => {
    for (const p of ['src/components/ui/Button.tsx', 'src/components/ui/IconButton.tsx']) {
      expect(read(p)).toContain('ring-primary/70');
      expect(read(p)).not.toContain('ring-primary/40');
    }
    const field = read('src/components/ui/Field.tsx');
    // Visibility pass: /30 composites to ~2.0:1 (below the 3:1 focus floor);
    // /70 matches the Button/IconButton pins above at 5.97:1.
    expect(field).toContain('focus:ring-primary/70');
    expect(field).toContain('placeholder:text-ink-muted ');
    expect(field).not.toContain('placeholder:text-ink-muted/');
    expect(field).toContain('text-base');
    expect(read('src/components/layout/SearchBar.tsx')).toContain('placeholder:text-ink-muted ');
  });

  it('keeps 16px text inputs on phones so iOS does not auto-zoom on focus', () => {
    expect(read('src/components/ui/Field.tsx')).toContain('text-base');
    expect(read('src/components/layout/SearchBar.tsx')).toContain('text-base');
  });

  it('keeps dialog descriptions wired and hidden-title close buttons visible', () => {
    const modal = read('src/components/ui/Modal.tsx');
    expect(modal).toContain('aria-describedby={description ? descriptionId : undefined}');
    expect(modal).toContain('hideTitle && "border-0 p-0"');
    expect(modal).toContain('<div className={cn(hideTitle && "sr-only")}>');
    expect(modal).toContain('hideTitle ? "absolute right-3 top-3');
    expect(modal).toContain('h-11 w-11');
  });

  it('announces async notices and focuses the first invalid field', () => {
    expect(read('src/components/ui/DemoNotice.tsx')).toContain('aria-live="polite"');
    const auth = read('src/components/account/AuthForms.tsx');
    expect(auth).toContain('focusFirstError("login-identifier")');
    expect(auth).toContain('focusFirstError("register-fullName")');
    expect(auth).toContain('focusFirstError("forgot-identifier")');
    expect(auth).toContain('name="username"');
    expect(read('src/components/account/ProfileForm.tsx')).toContain('focusFirstError("profile-email")');
    expect(read('src/components/account/AddressManager.tsx')).toContain('focusFirstError("addr-phone")');
  });

  it('uses React 19 ref-as-prop, never forwardRef, in the shared slice', () => {
    for (const p of sliceTsx) expect(read(p), p).not.toContain('forwardRef');
  });

  it('imports shared UI components directly, never through the barrel, in the shared slice', () => {
    for (const p of sliceTsx) {
      const source = read(p);
      expect(source, p).not.toContain('from "@/components/ui"');
      expect(source, p).not.toContain("from '@/components/ui'");
    }
  });

  it('never animates every property in the shared slice', () => {
    const cssFiles = [...walk('src/components/layout'), ...walk('src/components/loading'), ...walk('src/components/account'), 'src/app/globals.css'].filter((p) => p.endsWith('.css'));
    for (const p of [...sliceTsx, ...cssFiles]) {
      expect(read(p), p).not.toContain('transition-all');
      expect(read(p), p).not.toContain('transition: all');
    }
  });

  it('keeps the account loading fallback account-shaped', () => {
    const loading = read('src/app/(store)/account/loading.tsx');
    expect(loading).toContain('Loading account');
    expect(loading).not.toContain('ProductGridSkeleton');
  });
});
