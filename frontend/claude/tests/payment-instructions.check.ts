import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {PaymentInstructions} from '@/components/checkout/PaymentInstructions';
import type {PaymentDestination} from '@/types/manual-payment';
const destination:PaymentDestination={provider:'bkash',recipientNumber:'configured-in-test',accountType:'personal',transferInstructions:'Approved transfer instructions'};
it('renders the requested Bangla steps without claiming payment is disabled',()=>{
  const html=renderToStaticMarkup(createElement(PaymentInstructions,{destination,available:false}));
  expect(html).toContain('যেভাবে পেমেন্ট করবেন');expect(html).toContain('Send Money');expect(html).toContain('Transaction ID (TrxID)');expect(html).toContain('টাকা পাঠাবেন না। নিচের ধাপগুলোতে পেমেন্টের প্রক্রিয়াটি দেখানো হয়েছে।');expect(html).not.toContain('unavailable');expect(html).not.toContain('disabled');
});
it('does not direct Merchant accounts to Personal Send Money',()=>{
  const html=renderToStaticMarkup(createElement(PaymentInstructions,{destination:{...destination,accountType:'merchant',transferInstructions:'Use approved merchant payment flow.'},available:true}));
  expect(html).toContain('Use approved merchant payment flow.');expect(html).not.toContain('Send Money');expect(html).not.toContain('Personal Number');
});
