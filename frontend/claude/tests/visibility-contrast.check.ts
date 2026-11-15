import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Visibility-pass regression checks (2026-11-15). The hex pairs below are
 * the exact values in the admin stylesheets; the ratios are WCAG relative
 * luminance. Text pairs must clear 4.5:1, non-text UI (borders, tracks,
 * focus rings) must clear 3:1. The row-action regression check pins the
 * 1.00:1 bug: a <button class="aa-row-action"> used to inherit the solid
 * maroon fill while its text was also maroon.
 */

function luminance(hex: string): number {
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i + 1, i + 3), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function ratio(fg: string, bg: string): number {
  const sorted = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  const l1 = sorted[0]!;
  const l2 = sorted[1]!;
  return (l1 + 0.05) / (l2 + 0.05);
}

function composite(fg: string, alpha: number, bg: string): string {
  const mix = (i: number): number =>
    Math.round(alpha * parseInt(fg.slice(i + 1, i + 3), 16) + (1 - alpha) * parseInt(bg.slice(i + 1, i + 3), 16));
  return `#${[0, 2, 4].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
}

function css(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const adminPanel = css('../src/app/admin/admin-panel.css');
const adminCss = css('../src/app/admin/admin.css');
const globals = css('../src/app/globals.css');
const catalogue = css('../src/components/admin/catalog/catalogue-v2.module.css');

it('computes WCAG ratios correctly', () => {
  expect(ratio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  expect(ratio('#ffffff', '#6b0202')).toBeGreaterThan(12);
});

it('keeps button label contrast at or above 4.5:1', () => {
  expect(ratio('#ffffff', '#6b0202')).toBeGreaterThanOrEqual(4.5); // primary
  expect(ratio('#ffffff', '#400000')).toBeGreaterThanOrEqual(4.5); // base button
  expect(ratio('#6b0202', '#ffffff')).toBeGreaterThanOrEqual(4.5); // secondary / row action
  expect(ratio('#7a1010', '#fdf6f6')).toBeGreaterThanOrEqual(4.5); // danger row action
  expect(ratio('#ffffff', '#7a1010')).toBeGreaterThanOrEqual(4.5); // solid danger
  expect(ratio('#ffffff', '#5d0c0c')).toBeGreaterThanOrEqual(4.5); // danger hover
  expect(ratio('#6b0202', '#f6eaea')).toBeGreaterThanOrEqual(4.5); // row-action hover
});

it('keeps helper, muted, placeholder, and disabled text at or above 4.5:1', () => {
  expect(ratio('#5f5a57', '#ffffff')).toBeGreaterThanOrEqual(4.5); // admin muted token
  expect(ratio('#5f5a57', '#f6eaea')).toBeGreaterThanOrEqual(4.5); // muted on selected tint
  expect(ratio('#4a4643', '#ffffff')).toBeGreaterThanOrEqual(4.5); // tabs / bottom nav
  expect(ratio('#6f6a66', '#ffffff')).toBeGreaterThanOrEqual(4.5); // placeholder
  expect(ratio('#6b0202', '#efe3e3')).toBeGreaterThanOrEqual(4.5); // disabled label
  expect(ratio('#d8d4d6', '#3a3a42')).toBeGreaterThanOrEqual(4.5); // dark disabled label
});

it('keeps non-text UI contrast (borders, tracks, rings) at or above 3:1', () => {
  expect(ratio('#a86e6e', '#ffffff')).toBeGreaterThanOrEqual(3); // row-action / eye border
  expect(ratio('#8f8985', '#ffffff')).toBeGreaterThanOrEqual(3); // input / switch / dropzone
  expect(ratio('#b57a7a', '#ffffff')).toBeGreaterThanOrEqual(3); // danger row-action border
  expect(ratio('#6b0202', '#ffffff')).toBeGreaterThanOrEqual(3); // secondary border, focus ring
  expect(ratio('#6e6a75', '#111216')).toBeGreaterThanOrEqual(3); // dark input border
  expect(ratio('#7a7683', '#101114')).toBeGreaterThanOrEqual(3); // dark secondary border
  expect(ratio(composite('#ffffff', 0.55, '#400000'), '#400000')).toBeGreaterThanOrEqual(3); // sidebar secondary border
});

it('pins the row-action treatment that fixed the 1.00:1 invisible buttons', () => {
  expect(adminPanel).toContain('.aa-admin button.aa-row-action');
  expect(adminPanel).toContain('border: 1px solid #a86e6e');
  expect(adminPanel).toContain('background: #fff');
  expect(adminPanel).toContain('color: #6b0202');
  expect(adminPanel).toContain('.aa-admin button.aa-row-action--danger');
  expect(adminPanel).toContain('color: #7a1010');
});

it('pins the admin muted-token override and input/focus treatments', () => {
  expect(adminPanel).toContain('--aa-text-muted: 95 90 87');
  expect(adminCss).toContain('border: 1px solid #8f8985');
  expect(adminCss).toContain('border-color: #6b0202');
  expect(adminCss).toContain('color: #6f6a66');
  expect(adminPanel).toContain('border: 1px solid #8f8985');
  expect(adminPanel).toContain('outline: 2px solid rgb(var(--aa-primary))');
  expect(globals).toContain('outline: 2px solid rgb(var(--aa-primary))');
  expect(globals).not.toContain('rgb(var(--aa-primary) / 0.5)');
  expect(adminPanel).not.toContain('rgb(var(--aa-primary) / 0.45)');
});

it('pins the switch and dropzone treatments', () => {
  expect(catalogue).toContain('background: #8f8985');
  expect(catalogue).toContain('border: 2px dashed #8f8985');
  expect(catalogue).toContain('prefers-reduced-motion');
});

it('keeps disabled buttons off whole-element opacity', () => {
  expect(adminCss).not.toContain('opacity: 0.55');
  expect(adminCss).toContain('cursor: not-allowed');
});

it('introduces no transition: all in the touched stylesheets', () => {
  for (const sheet of [adminPanel, adminCss, globals, catalogue]) {
    expect(sheet).not.toContain('transition: all');
  }
});
