import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ManualAdvancePayment} from '@/components/checkout/ManualAdvancePayment';
import {PaymentMethodSelector} from '@/components/checkout/PaymentMethodSelector';
import type {ManualPaymentConfiguration} from '@/types/manual-payment';

const policy = { insideDhakaMinor: 7000, outsideDhakaMinor: 13000, credit: "against-order-total" as const };
const destinations = [{ provider: "bkash" as const, recipientNumber: "configured-in-test", accountType: "personal" as const, transferInstructions: "" }];
const base = { totalMinor: 200000, division: "Dhaka", district: "Dhaka" };

function html(available: boolean, isProduction = false) {
  const configuration: ManualPaymentConfiguration = { available, policy, destinations };
  return renderToStaticMarkup(createElement(ManualAdvancePayment, { mode: "online", configuration, ...base, isProduction }));
}

function selectorHtml(onlineEnabled: boolean, previewEnabled: boolean, isProduction = false) {
  return renderToStaticMarkup(createElement(PaymentMethodSelector, { value: "online", onChange: () => undefined, onlineEnabled, previewEnabled, isProduction }));
}

it('shows working instructions when collection is available', () => {
  const out = html(true, true);
  expect(out).toContain('ডেলিভারি চার্জসহ পুরো অর্ডারের টাকা নিচের নম্বরে পাঠান');
  expect(out).toContain('TrxID');
  expect(out).toContain('আপনার PIN বা OTP কাউকে দেবেন না।');
  expect(out).toContain('পেমেন্ট Submit করুন');
  expect(out).not.toContain('Submit Payment');
  expect(out).not.toContain('Live collection is disabled');
  expect(out).not.toContain('Submissions are unavailable');
  expect(out).not.toContain('প্রিভিউতে পেমেন্ট নেওয়া যাচ্ছে না');
});

it('names the preview limitation when collection is off in a preview', () => {
  const out = html(false, false);
  expect(out).toContain('এই প্রিভিউতে পেমেন্ট নেওয়া যাচ্ছে না। টাকা পাঠাবেন না।');
  expect(out).toContain('এই প্রিভিউতে পেমেন্টের তথ্য জমা দেওয়া যাচ্ছে না।');
  expect(out).toContain('পেমেন্ট Submit করুন');
  expect(out).not.toContain('Submit Payment');
  expect(out).not.toContain('ডেলিভারি চার্জসহ পুরো অর্ডারের টাকা');
  expect(out).not.toContain('Live collection is disabled');
  expect(out).not.toContain('Submissions are unavailable');
});

it('does not name a preview on production when collection is off', () => {
  const out = html(false, true);
  expect(out).toContain('এই মুহূর্তে পেমেন্ট নেওয়া যাচ্ছে না। টাকা পাঠাবেন না।');
  expect(out).toContain('এই মুহূর্তে পেমেন্টের তথ্য জমা দেওয়া যাচ্ছে না।');
  expect(out).not.toContain('প্রিভিউ');
  expect(out).not.toContain('Live collection is disabled');
  expect(out).not.toContain('Submissions are unavailable');
});

it('shows the selector description in Bangla for every collection state', () => {
  expect(selectorHtml(true, true, true)).toContain('পুরো অর্ডারের টাকা পে করুন।');
  const preview = selectorHtml(false, true, false);
  expect(preview).toContain('শুধু প্রিভিউ। পেমেন্ট নেওয়া যাচ্ছে না।');
  const production = selectorHtml(false, true, true);
  expect(production).toContain('এই মুহূর্তে পেমেন্ট নেওয়া যাচ্ছে না।');
  expect(production).not.toContain('প্রিভিউ');
  for (const out of [selectorHtml(true, true, true), preview, production]) {
    expect(out).not.toContain('Collection is disabled');
    expect(out).not.toContain('Pay the full order total.');
    expect(out).not.toContain('Currently unavailable.');
  }
});
